const express = require('express');
const path = require('path');
const db = require('./database/db');
const session = require('express-session');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const fs = require('fs-extra');
const PDFDocument = require('pdfkit');
const bodyParser = require('body-parser');
const archiver = require('archiver');
const moment = require('moment');
const { render } = require('ejs');
const { google } = require('googleapis');


const app = express();
const BACKUP_HISTORY_FILE = path.join(__dirname, 'data', 'backup_history.json');
const activeDownloads = new Set();


// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (CSS) from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Routes
// app.get('/', (req, res) => {
//   res.render('index'); // Home page
// });
app.get('/backup-interface', (req, res) => {
  res.render('backup');
});
app.get('/reports', (req, res) => {
  res.render('reports');
});

// Add this route to your existing server.js file

const fetchTodaysReleasedBills = () => {
  return new Promise((resolve, reject) => {
    const today = moment().format('YYYY-MM-DD');
    
    // Query to get bills released today from both tables
    const regularQuery = `SELECT "Bill No" FROM Release_Records WHERE Date = ?`;
    const sQuery = `SELECT "Bill No" FROM S_Release_Records WHERE Date = ?`;
    
    const releasedBills = [];
    
    // Query the regular Release_Records table
    db.all(regularQuery, [today], (err, rows) => {
      if (err) {
        console.error('Error querying Release_Records:', err.message);
        reject(err);
        return;
      }
      
      // Add bill numbers to the array
      rows.forEach(row => {
        releasedBills.push(row['Bill No']);
      });
      
      // Now query the S_Release_Records table
      db.all(sQuery, [today], (err, sRows) => {
        if (err) {
          console.error('Error querying S_Release_Records:', err.message);
          reject(err);
          return;
        }
        
        // Add S bill numbers to the same array
        sRows.forEach(row => {
          releasedBills.push(row['Bill No']);
        });
        
        // Sort bill numbers for better display
        releasedBills.sort();
        resolve(releasedBills);
      });
    });
  });
};

// Update your home route to include the released bills
app.get('/', async (req, res) => {
  try {
    const releasedBills = await fetchTodaysReleasedBills();
    res.render('index', { 
      releasedBills,
      showReleasedBillsContainer: releasedBills.length > 0 
    });
  } catch (err) {
    console.error('Error fetching today\'s released bills:', err);
    res.render('index', { 
      releasedBills: [],
      showReleasedBillsContainer: false
    });
  }
});


// Ensure the data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Initialize backup history file if it doesn't exist
if (!fs.existsSync(BACKUP_HISTORY_FILE)) {
    fs.writeFileSync(BACKUP_HISTORY_FILE, JSON.stringify([]));
}

// Helper function to read backup history
function readBackupHistory() {
    try {
        const data = fs.readFileSync(BACKUP_HISTORY_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading backup history:', error);
        return [];
    }
}

// Helper function to write backup history
function writeBackupHistory(history) {
    try {
        fs.writeFileSync(BACKUP_HISTORY_FILE, JSON.stringify(history, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing backup history:', error);
        return false;
    }
}

// Route to get backup history
app.get('/get-backup-history', (req, res) => {
    try {
        const history = readBackupHistory();
        res.json(history);
    } catch (error) {
        console.error('Error retrieving backup history:', error);
        res.status(500).json({ error: 'Failed to retrieve backup history' });
    }
});

// Route to record a new backup
app.post('/record-backup', (req, res) => {
    try {
        const { type, customDate, timestamp, status } = req.body;
        
        // Validate required fields
        if (!type || !timestamp || !status) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Create backup record
        const backupRecord = {
            type,
            customDate,
            timestamp,
            status
        };
        
        // Get existing history
        let history = readBackupHistory();
        
        // Add new record to the beginning
        history.unshift(backupRecord);
        
        // Keep only most recent 20 records
        if (history.length > 20) {
            history = history.slice(0, 20);
        }
        
        // Save updated history
        const success = writeBackupHistory(history);
        
        if (success) {
            res.json({ success: true, message: 'Backup history recorded successfully' });
        } else {
            res.status(500).json({ error: 'Failed to record backup history' });
        }
    } catch (error) {
        console.error('Error recording backup:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Modified backup endpoint to handle different types of backup
app.get('/backup', (req, res) => {
  const backupType = req.query.type || 'today';
  const customDate = req.query.date;
  
  let date;
  if (backupType === 'custom' && customDate) {
    date = customDate;
  } else {
    date = new Date().toISOString().split('T')[0];
  }

  // Define backup directories
  const backupDir = path.join(__dirname, 'backup');
  const activeDir = path.join(backupDir, 'active');
  const releasedDir = path.join(backupDir, 'released');
  
  // Ensure directories exist
  fs.ensureDirSync(backupDir);
  fs.ensureDirSync(activeDir);
  fs.ensureDirSync(path.join(activeDir, 'active_pledges'));
  fs.ensureDirSync(path.join(activeDir, 'S_active_pledges'));
  fs.ensureDirSync(releasedDir);
  fs.ensureDirSync(path.join(releasedDir, 'released_pledges'));
  fs.ensureDirSync(path.join(releasedDir, 'S_released_pledges'));

  try {
    if (backupType === 'complete') {
      // Complete data backup - fetch all data from all tables
      Promise.all([
        createBackup('active_pledges', null, 'complete_data_active_pledges', activeDir),
        createBackup('S_active_pledges', null, 'complete_data_S_active_pledges', activeDir),
        createBackup('released_pledges', null, 'complete_data_released_pledges', releasedDir),
        createBackup('S_released_pledges', null, 'complete_data_S_released_pledges', releasedDir)
      ])
      .then(() => {
        res.status(200).send('Complete backup completed successfully!');
      })
      .catch(error => {
        console.error('Error during complete backup:', error);
        res.status(500).send('Error creating complete backup files.');
      });
    } else {
      // Today's or custom date backup
      const filePrefix = date;
      
      Promise.all([
        createBackup('active_pledges', date, `${filePrefix}_active_pledges`, activeDir),
        createBackup('S_active_pledges', date, `${filePrefix}_S_active_pledges`, activeDir),
        createBackup('released_pledges', date, `${filePrefix}_released_pledges`, releasedDir),
        createBackup('S_released_pledges', date, `${filePrefix}_S_released_pledges`, releasedDir)
      ])
      .then(() => {
        res.status(200).send(`Backup for ${date} completed successfully!`);
      })
      .catch(error => {
        console.error(`Error during ${date} backup:`, error);
        res.status(500).send(`Error creating backup files for ${date}.`);
      });
    }
  } catch (err) {
    console.error('Error processing backup:', err);
    res.status(500).send('Error processing backup request.');
  }
});

// Google Drive API setup
const KEYFILE_PATH = path.join(__dirname, 'config', 'apikeys.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];

// Google Drive backup endpoint
app.get('/backup-to-google-drive', async (req, res) => {
  try {
    // Initialize Google Drive API
    const auth = new google.auth.GoogleAuth({
      keyFile: KEYFILE_PATH,
      scopes: SCOPES
    });
    
    const client = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: client });
    
    console.log('Google Drive API authenticated successfully');
    
    // Define Google Drive folder IDs
    const folderIds = {
      pledges: '1HRJUxL6xweca6pt3RAo6o5XEAnCvZhVc',      // Active and Released pledges
      dayBook: '1DZRkO1qaKrbhx3vzH44q2Xg9Ev4DkhiY',      // Day Books
      pledgeRecords: '1m_TJ68YX653gMPSzDrINA8D1SNw9bWbj', // Pledge Records
      releaseRecords: '1tEteADC0U3qiVr2QpEEqMvHC6RZo1kan', // Release Records
      expenses: '12PN38VfrPnjpqIPargkSbjBBC_qDFpy8'       // Expenses (newly added)
    };
    
    // Temporary directory for Excel files
    const tempDir = path.join(__dirname, 'temp_google_drive_backup');
    fs.ensureDirSync(tempDir);
    
    // Create backup files and upload to Google Drive
    await Promise.all([
      // 1. Active and Released Pledges
      createAndUploadExcel(
        ['active_pledges', 'S_active_pledges', 'released_pledges', 'S_released_pledges'],
        ['Active.xlsx', 'S_Active.xlsx', 'Released.xlsx', 'S_Released.xlsx'],
        folderIds.pledges,
        drive,
        tempDir
      ),
      
      // 2. Day Books
      createAndUploadExcel(
        ['Day_Book', 'S_Day_Book'],
        ['Day_Book.xlsx', 'S_Day_Book.xlsx'],
        folderIds.dayBook,
        drive,
        tempDir
      ),
      
      // 3. Pledge Records
      createAndUploadExcel(
        ['Pledge_Records', 'S_Pledge_Records'],
        ['Pledge_Records.xlsx', 'S_Pledge_Records.xlsx'],
        folderIds.pledgeRecords,
        drive,
        tempDir
      ),
      
      // 4. Release Records
      createAndUploadExcel(
        ['Release_Records', 'S_Release_Records'],
        ['Release_Records.xlsx', 'S_Release_Records.xlsx'],
        folderIds.releaseRecords,
        drive,
        tempDir
      ),
      
      // 5. Expenses (newly added)
      createAndUploadExcel(
        ['Expenses', 'S_Expenses'],
        ['Expenses.xlsx', 'S_Expenses.xlsx'],
        folderIds.expenses,
        drive,
        tempDir
      )
    ]);
    
    // Clean up temp directory after all operations are complete
    fs.removeSync(tempDir);
    
    console.log('Google Drive backup completed successfully');
    res.status(200).send('Google Drive backup completed successfully!');
  } catch (error) {
    console.error('Error during Google Drive backup:', error);
    res.status(500).send('Error during Google Drive backup. Please check server logs.');
  }
});

// Helper function to create backup for a specific table
function createBackup(tableName, date, fileName, directory) {
  return new Promise((resolve, reject) => {
    let query;
    let params = [];
    
    if (date) {
      query = `SELECT * FROM ${tableName} WHERE date = ?`;
      params = [date];
    } else {
      query = `SELECT * FROM ${tableName}`;
    }
    
    db.all(query, params, (err, data) => {
      if (err) {
        console.error(`Error fetching data from ${tableName}:`, err.message);
        return reject(err);
      }
      
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(tableName);
      
      // Add data to worksheet
      if (data.length > 0) {
        sheet.columns = Object.keys(data[0]).map(key => ({ header: key, key }));
        data.forEach(row => sheet.addRow(row));
      } else {
        sheet.addRow({ message: `No data available for ${tableName}${date ? ' on ' + date : ''}.` });
      }
      
      // Sub-directory for table type
      const tableDir = path.join(directory, tableName);
      fs.ensureDirSync(tableDir);
      
      const filePath = path.join(tableDir, `${fileName}.xlsx`);
      
      workbook.xlsx.writeFile(filePath)
        .then(() => {
          console.log(`Backup successful for ${tableName} to ${filePath}`);
          resolve();
        })
        .catch(writeError => {
          console.error(`Error writing Excel file for ${tableName}:`, writeError.message);
          reject(writeError);
        });
    });
  });
}

// Helper function to fetch table data
function fetchTableData(tableName) {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM ${tableName}`;
    
    db.all(query, [], (err, data) => {
      if (err) {
        console.error(`Error fetching data from ${tableName}:`, err.message);
        return reject(err);
      }
      resolve(data || []);
    });
  });
}

// Helper function to create Excel file from table data
async function createExcelFile(tableName, filePath) {
  try {
    const data = await fetchTableData(tableName);
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(tableName);
    
    // Add data to worksheet
    if (data.length > 0) {
      sheet.columns = Object.keys(data[0]).map(key => ({ header: key, key }));
      data.forEach(row => sheet.addRow(row));
    } else {
      sheet.addRow({ message: `No data available for ${tableName}.` });
    }
    
    await workbook.xlsx.writeFile(filePath);
    console.log(`Excel file created for ${tableName} at ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`Error creating Excel file for ${tableName}:`, error);
    throw error;
  }
}

// Helper function to upload file to Google Drive
async function uploadToGoogleDrive(drive, filePath, fileName, folderId) {
  try {
    // Check if file already exists in the folder
    const response = await drive.files.list({
      q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id, name)'
    });
    
    const existingFiles = response.data.files;
    
    // If file exists, delete it first
    if (existingFiles && existingFiles.length > 0) {
      for (const file of existingFiles) {
        console.log(`Deleting existing file: ${file.name} (${file.id})`);
        await drive.files.delete({ fileId: file.id });
      }
    }
    
    // Create new file
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };
    
    const media = {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(filePath)
    };
    
    const uploadResponse = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });
    
    console.log(`Uploaded ${fileName} to Google Drive with ID: ${uploadResponse.data.id}`);
    return uploadResponse.data.id;
  } catch (error) {
    console.error(`Error uploading ${fileName} to Google Drive:`, error);
    throw error;
  }
}

// Helper function to create and upload multiple Excel files
async function createAndUploadExcel(tableNames, fileNames, folderId, drive, tempDir) {
  try {
    const tasks = [];
    
    for (let i = 0; i < tableNames.length; i++) {
      const tableName = tableNames[i];
      const fileName = fileNames[i];
      const filePath = path.join(tempDir, fileName);
      
      tasks.push(
        (async () => {
          await createExcelFile(tableName, filePath);
          await uploadToGoogleDrive(drive, filePath, fileName, folderId);
        })()
      );
    }
    
    await Promise.all(tasks);
    console.log(`Successfully processed tables: ${tableNames.join(', ')}`);
  } catch (error) {
    console.error(`Error in createAndUploadExcel:`, error);
    throw error;
  }
}


function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function runUpdate(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

// Expense routes
app.get('/expense', (req, res) => {
  res.render('expense'); // Expense management page
});

// Get expenses for a specific month and year
app.get('/get-expenses', async (req, res) => {
  const { month, year, useSecondaryTable } = req.query;
  const tableName = (useSecondaryTable === true || useSecondaryTable === 'true') ? 'S_Expenses' : 'Expenses';  
  try {
    // Format month to ensure it's 2 digits (e.g., '01' instead of '1')
    const formattedMonth = month.padStart(2, '0');
    
    // Create date range for the month
    const startDate = `${year}-${formattedMonth}-01`;
    const endDate = moment(`${year}-${formattedMonth}-01`).endOf('month').format('YYYY-MM-DD');
    
    // Query to match the refactored table structure
    const query = `SELECT * FROM ${tableName} WHERE strftime('%m', "Date") = ? AND strftime('%Y', "Date") = ? ORDER BY "Date"`;
    const expenses = await runQuery(query, [formattedMonth, year]);
    
    // Transform data to match the expected format in the client
    const transformedExpenses = expenses.map(expense => ({
      id: expense['Date'],
      ExpenseDate: expense['Date'],
      ExpenseDetails: expense['Expense Details'],
      TotalAmount: expense['Total Expense']
    }));
    
    res.json({ success: true, expenses: transformedExpenses });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch expenses' });
  }
});

// Add new expense
app.post('/add-expense', async (req, res) => {
  const { expenseDate, expenseDetails, totalAmount, useSecondaryTable } = req.body;
  const tableName = (useSecondaryTable === true || useSecondaryTable === 'true') ? 'S_Expenses' : 'Expenses';  
  try {
    // Parse the expense date to ensure consistent format
    const formattedDate = moment(expenseDate).format('YYYY-MM-DD');
    
    // Check if an expense for this date already exists
    const checkQuery = `SELECT 1 FROM ${tableName} WHERE "Date" = ?`;
    const existingExpense = await runQuery(checkQuery, [formattedDate]);
    
    if (existingExpense.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: `An expense for this date already exists in the ${tableName} table. Please use the edit function instead.`
      });
    }
    
    // Store expense in database with the refactored schema
    const query = `INSERT INTO ${tableName} 
      ("Date", "Expense Details", "Total Expense") 
      VALUES (?, ?, ?)`;
    
    await runUpdate(query, [
      formattedDate, 
      JSON.stringify(expenseDetails), 
      totalAmount
    ]);
    
    res.json({ 
      success: true, 
      message: `Expense added successfully to ${tableName} table!`
    });
  } catch (error) {
    console.error('Error adding expense:', error);
    res.status(500).json({ success: false, error: 'Failed to add expense' });
  }
});

// Get a specific expense by ID (date)
app.get('/get-expense/:id', async (req, res) => {
  const { id } = req.params;
  const { useSecondaryTable } = req.query;
  const tableName = (useSecondaryTable === true || useSecondaryTable === 'true') ? 'S_Expenses' : 'Expenses';  
  try {
    // Query with the date as the key
    const query = `SELECT * FROM ${tableName} WHERE "Date" = ?`;
    const results = await runQuery(query, [id]);
    
    if (results.length === 0) {
      return res.status(404).json({ success: false, error: 'Expense not found' });
    }
    
    // Transform data to match client expectations
    const expense = {
      id: results[0]['Date'],
      ExpenseDate: results[0]['Date'],
      ExpenseDetails: results[0]['Expense Details'],
      TotalAmount: results[0]['Total Expense']
    };
    
    res.json({ success: true, expense });
  } catch (error) {
    console.error('Error fetching expense:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch expense' });
  }
});

// Update an existing expense
app.put('/update-expense/:id', async (req, res) => {
  const { id } = req.params;
  const { expenseDate, expenseDetails, totalAmount, useSecondaryTable } = req.body;
  const tableName = (useSecondaryTable === true || useSecondaryTable === 'true') ? 'S_Expenses' : 'Expenses';  
  try {
    // Parse the expense date to ensure consistent format
    const formattedDate = moment(expenseDate).format('YYYY-MM-DD');
    
    // If the date has changed, check if an expense with the new date already exists
    if (id !== formattedDate) {
      const checkQuery = `SELECT 1 FROM ${tableName} WHERE "Date" = ?`;
      const existingExpense = await runQuery(checkQuery, [formattedDate]);
      
      if (existingExpense.length > 0) {
        return res.status(409).json({ 
          success: false, 
          error: `An expense for the new date already exists in the ${tableName} table. Please choose a different date.`
        });
      }
      
      // Delete the old record if the date has changed
      const deleteQuery = `DELETE FROM ${tableName} WHERE "Date" = ?`;
      await runUpdate(deleteQuery, [id]);
      
      // Insert new record with the updated date
      const insertQuery = `INSERT INTO ${tableName} 
        ("Date", "Expense Details", "Total Expense") 
        VALUES (?, ?, ?)`;
      
      await runUpdate(insertQuery, [
        formattedDate, 
        JSON.stringify(expenseDetails), 
        totalAmount
      ]);
    } else {
      // Update the existing record if the date hasn't changed
      const updateQuery = `UPDATE ${tableName} SET 
        "Expense Details" = ?, 
        "Total Expense" = ? 
        WHERE "Date" = ?`;
      
      await runUpdate(updateQuery, [
        JSON.stringify(expenseDetails), 
        totalAmount, 
        formattedDate
      ]);
    }
    
    res.json({ 
      success: true, 
      message: `Expense updated successfully in ${tableName} table!`
    });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ success: false, error: 'Failed to update expense' });
  }
});


// Generate PDF report for expenses
app.get('/generate-expense-pdf', async (req, res) => {
  const { month, year, useSecondaryTable } = req.query;
  const tableName = (useSecondaryTable === true || useSecondaryTable === 'true') ? 'S_Expenses' : 'Expenses';

  try {
    const formattedMonth = month.padStart(2, '0');
    const query = `SELECT * FROM ${tableName} WHERE strftime('%m', "Date") = ? AND strftime('%Y', "Date") = ? ORDER BY "Date"`;
    const expenses = await runQuery(query, [formattedMonth, year]);

    if (expenses.length === 0) {
      return res.status(404).json({ success: false, error: 'No expenses found for this month and year' });
    }

    const PDFDocument = require('pdfkit');
    const moment = require('moment');
    // Increase margins for better spacing
    const doc = new PDFDocument({ 
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
      bufferPages: true // Enable page buffering for better page numbering
    });
    const fileName = `expenses_${year}_${formattedMonth}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    doc.pipe(res);

    const drawSeparator = (yPosition) => {
      doc.strokeColor('#D3D3D3')
         .lineWidth(1)
         .moveTo(50, yPosition)
         .lineTo(doc.page.width - 50, yPosition)
         .stroke();
    };

    const monthName = moment(`${year}-${formattedMonth}-01`).format('MMMM');
    const pageWidth = doc.page.width - 100; // Adjust for increased margins
    const columnWidths = [100, pageWidth - 200, 100];
    const positions = {
      date: 60,
      details: 60 + columnWidths[0] + 10, // Add 10px padding between columns
      amount: 60 + columnWidths[0] + columnWidths[1] + 10, // Add 10px padding
      widths: columnWidths
    };

    // Enhanced header rendering with better spacing
    const renderHeader = (isContinued = false) => {
      doc.fillColor('#2c3e50')
         .fontSize(24) // Slightly larger font
         .font('Helvetica-Bold')
         .text('Shanthi Pawn Brokers', { align: 'center' });
      doc.moveDown(0.8); // More space after title
      drawSeparator(doc.y);
      doc.moveDown(1.2); // More space after separator

      doc.fontSize(18) // Slightly larger font
         .text(`Expense Report for ${monthName} ${year}${isContinued ? ' (Continued)' : ''}`, { align: 'center' });
      doc.moveDown(1.2); // More space after subtitle

      const centerX = doc.page.width / 2;
      doc.save()
         .moveTo(centerX - 100, doc.y) // Wider decorative line
         .lineTo(centerX + 100, doc.y)
         .strokeColor('#4d7c8a')
         .lineWidth(2.5) // Slightly thicker line
         .stroke()
         .restore();
      doc.moveDown(2.5); // More space after decorative line

      renderTableHeader();
    };

    // Enhanced table header with better spacing
    const renderTableHeader = () => {
      const headers = ['Date', 'Expense Details', 'Total Amount'];
      // Increase header height for better spacing
      const headerHeight = 35;
      const headerY = doc.y;

      // Header background with rounded corners
      doc.roundedRect(50, headerY, doc.page.width, headerHeight, 4)
         .fillColor('#f0f5fa') // Lighter blue background
         .fill();

      // Add header text with more vertical space
      doc.fillColor('#2c3e50').fontSize(13).font('Helvetica-Bold');
      
      // Center text vertically in header
      const textY = headerY + (headerHeight / 2) - 6;
      
      doc.text(headers[0], positions.date, textY, { width: columnWidths[0], align: 'left' });
      doc.text(headers[1], positions.details, textY, { width: columnWidths[1], align: 'left' });
      doc.text(headers[2], positions.amount, textY, { width: columnWidths[2], align: 'right' });

      doc.y = headerY + headerHeight + 10; // Add extra space after header
    };

    renderHeader();

    let totalExpense = 0;
    let isAlternateRow = false;
    let rowCounter = 0;

    for (let expense of expenses) {
      rowCounter++;
      const formattedDate = moment(expense['Date']).format('DD-MM-YYYY');

      // Parse expense details
      let expenseDetails = expense['Expense Details'];
      try {
        const parsed = JSON.parse(expenseDetails);
        if (Array.isArray(parsed)) {
          expenseDetails = parsed.map(item =>
            `${item.description || 'Item'}: ${item.amount || 0}`
          ).join(', ');
        } else if (typeof parsed === 'object') {
          expenseDetails = Object.entries(parsed)
            .map(([k, v]) => `${k}: ${v}`).join(', ');
        }
      } catch (_) {}

      const amountValue = parseFloat(expense['Total Expense']) || 0;
      const formattedAmount = new Intl.NumberFormat('en-IN', {
        useGrouping: true,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amountValue);

      // Calculate row height based on content with minimum height and extra padding
      const minRowHeight = 30; // Increase minimum row height for better spacing
      const rowTextHeight = Math.max(
        doc.heightOfString(formattedDate, { width: positions.widths[0] }),
        doc.heightOfString(expenseDetails, { width: positions.widths[1] }),
        doc.heightOfString(formattedAmount, { width: positions.widths[2] })
      );
      const rowHeight = Math.max(rowTextHeight, minRowHeight);
      
      // Add extra spacing between rows
      const rowPadding = 15; // Increased padding between rows
      const startY = doc.y;

      // Add alternating row background with rounded corners
      if (isAlternateRow) {
        doc.roundedRect(50, startY - 2, doc.page.width - 100, rowHeight + 4, 3)
           .fillColor('#f9f9f9')
           .fill();
      }

      doc.fillColor('#333333').fontSize(11).font('Helvetica'); // Slightly larger font for better readability
      doc.text(formattedDate, positions.date, startY, { width: positions.widths[0], align: 'left' });
      doc.text(expenseDetails, positions.details, startY, { width: positions.widths[1], align: 'left' });
      doc.text(formattedAmount, positions.amount, startY, { width: positions.widths[2], align: 'right' });

      doc.y = startY + rowHeight + rowPadding;
      
      // Only draw separators between rows (not after the last row of the page)
      if (rowCounter < expenses.length && doc.y < doc.page.height - 120) {
        drawSeparator(doc.y - (rowPadding / 2));
      }

      totalExpense += amountValue;
      isAlternateRow = !isAlternateRow;

      // Check if we need a new page with more conservative threshold
      if (doc.y > doc.page.height - 120) {
        doc.addPage();
        renderHeader(true);
        rowCounter = 0; // Reset row counter for new page
      }
    }

    // Final total section with improved styling
    doc.moveDown(2);
    
    // Create gradient background for total section
    doc.roundedRect(50, doc.y - 5, doc.page.width - 100, 40, 5)
       .fillColor('#4d7c8a')
       .fill();

    const formattedTotal = new Intl.NumberFormat('en-IN', {
      useGrouping: true,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(totalExpense.toFixed(2));

    doc.fillColor('#ffffff')
       .font('Helvetica-Bold')
       .fontSize(14) // Larger font for total
       .text(`Total Expenses for ${monthName} ${year}: ${formattedTotal}`, 
         50, doc.y + 10, {
         align: 'center',
         width: doc.page.width - 100
       });

    // Enhanced footer with better spacing
    const totalPages = doc._pageBuffer.length;
    
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      
      const footerY = doc.page.height - 60;
      drawSeparator(footerY);
      
      doc.fontSize(9).fillColor('#666666') // Slightly larger font for footer
         .text(`Generated on: ${moment().format('DD-MM-YYYY HH:mm')}`, 60, footerY + 15)
         .text('Shanthi Pawn Brokers - Confidential', 0, footerY + 15, { align: 'center' })
         .text(`Page ${i + 1} of ${totalPages}`, 0, footerY + 15, {
           align: 'right',
           width: doc.page.width - 60
         });
    }

    doc.end();

  } catch (error) {
    console.error('Error generating expense PDF:', error);
    res.status(500).json({ success: false, error: 'Failed to generate expense PDF' });
  }
});


// API to fetch Pledge Records data
app.get('/pledgeRecords', (req,res) => {
  res.render('pledgeRecords');
})
// API to fetch Pledge Records data
// API to fetch Pledge Records data
app.get('/pledge-records-data', (req, res) => {
  const { fromDate, toDate, isSpecial } = req.query;
  
  // Validate date inputs
  if (!fromDate || !toDate) {
    return res.json({ success: false, error: 'Both from and to dates are required' });
  }
  
  // Convert isSpecial string to boolean properly
  const useSpecialTable = isSpecial === 'true';
  
  // Determine which table to use based on the toggle
  const tableName = useSpecialTable ? 'S_Pledge_Records' : 'Pledge_Records';
  
  const query = `SELECT * FROM ${tableName} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  
  db.all(query, [fromDate, toDate], (err, records) => {
    if (err) {
      console.error(`Error fetching data from ${tableName}:`, err.message);
      return res.json({ success: false, error: err.message });
    }
    
    // Group records by date
    const groupedRecords = {};
    
    records.forEach(record => {
      const date = record.Date;
      
      if (!groupedRecords[date]) {
        groupedRecords[date] = [];
      }
      
      groupedRecords[date].push(record);
    });
    
    res.json({ success: true, groupedRecords });
  });
});

// Generate Excel file for Pledge Records
// Generate Excel file for Pledge Records
// First, add this to the top of your server-side file where other declarations are
// This will track active downloads
// Update the Excel download endpoint
app.get('/pledge-records-excel', (req, res) => {
  const { fromDate, toDate, isSpecial, columns, downloadToken } = req.query;
  
  // Add the token to active downloads
  if (downloadToken) {
    activeDownloads.add(downloadToken);
  }
  
  // Validate inputs
  if (!fromDate || !toDate) {
    return res.status(400).send('Missing required parameters');
  }
  
  // Convert isSpecial string to boolean properly
  const useSpecialTable = isSpecial === 'true';
  
  // Determine which table to use based on the toggle
  const tableName = useSpecialTable ? 'S_Pledge_Records' : 'Pledge_Records';
  
  const query = `SELECT * FROM ${tableName} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  
  db.all(query, [fromDate, toDate], (err, records) => {
    if (err) {
      console.error(`Error fetching data from ${tableName}:`, err.message);
      return res.status(500).send('Database error');
    }
    
    // Group records by date (like in the display function)
    const groupedRecords = {};
    
    records.forEach(record => {
      const date = record.Date;
      
      if (!groupedRecords[date]) {
        groupedRecords[date] = [];
      }
      
      groupedRecords[date].push(record);
    });
    
    // Process the data based on selected columns
    const selectedColumns = columns ? columns.split(',') : ['Date', 'BillNumber', 'PledgeAmount', 'GoldWeight', 'SilverWeight', 'DailyTotal'];
    
    // Create a workbook using ExcelJS
    const Excel = require('exceljs');
    const workbook = new Excel.Workbook();
    const worksheet = workbook.addWorksheet('Pledge Records');
    
    // Add headers based on selected columns
    const headers = [];
    if (selectedColumns.includes('Date')) headers.push('Date');
    if (selectedColumns.includes('BillNumber')) headers.push('Bill Numbers');
    if (selectedColumns.includes('PledgeAmount')) headers.push('Pledge Amounts');
    if (selectedColumns.includes('GoldWeight')) headers.push('Gold Weight (g)');
    if (selectedColumns.includes('SilverWeight')) headers.push('Silver Weight (g)');
    if (selectedColumns.includes('DailyTotal')) headers.push('Daily Total');
    
    worksheet.addRow(headers);
    
    // Add data rows based on selected columns
    const sortedDates = Object.keys(groupedRecords).sort((a, b) => new Date(a) - new Date(b));
    
    sortedDates.forEach(date => {
      const records = groupedRecords[date];
      
      // Calculate daily totals
      let dailyTotal = 0;
      let totalGoldWeight = 0;
      let totalSilverWeight = 0;
      let billNumbers = [];
      let pledgeAmounts = [];
      
      records.forEach(record => {
        billNumbers.push(record['Bill No']);
        pledgeAmounts.push(record['Pledge Amount']);
        dailyTotal += record['Pledge Amount'];
        totalGoldWeight += record['Pledged Gold Weight'];
        totalSilverWeight += record['Pledged Silver Weight'];
      });
      
      // Format date for display
      const dateObj = new Date(date);
      const formattedDate = dateObj.toLocaleDateString('en-GB');
      
      // Add row data based on selected columns
      const rowData = [];
      if (selectedColumns.includes('Date')) rowData.push(formattedDate);
      if (selectedColumns.includes('BillNumber')) rowData.push(billNumbers.join(', '));
      if (selectedColumns.includes('PledgeAmount')) rowData.push(pledgeAmounts.join(', '));
      if (selectedColumns.includes('GoldWeight')) rowData.push(totalGoldWeight);
      if (selectedColumns.includes('SilverWeight')) rowData.push(totalSilverWeight);
      if (selectedColumns.includes('DailyTotal')) rowData.push(dailyTotal);
      
      worksheet.addRow(rowData);
    });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=PledgeRecords-${fromDate}-to-${toDate}.xlsx`);
    
    // Write Excel file to response
    workbook.xlsx.write(res)
      .then(() => {
        res.end();
        // Mark this download as complete
        if (downloadToken) {
          // Keep the token in activeDownloads so it can be checked
          // It will be removed after the client confirms receipt
        }
      })
      .catch(err => {
        console.error('Error generating Excel:', err);
        res.status(500).send('Error generating Excel file');
        // Remove the token if there was an error
        if (downloadToken) {
          activeDownloads.delete(downloadToken);
        }
      });
  });
});

// Update the check download status endpoint
app.get('/check-download-status', (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).json({ complete: false, error: 'Missing token' });
  }
  
  const isComplete = activeDownloads.has(token);
  
  if (isComplete) {
    // Remove the token after sending response
    activeDownloads.delete(token);
  }
  
  res.json({ complete: isComplete });
});

// Route to render the Release Records page
app.get('/releaseRecords', (req, res) => {
  res.render('releaseRecords');
});

// API to fetch Release Records data
app.get('/release-records-data', (req, res) => {
  const { fromDate, toDate, isSpecial } = req.query;
  
  // Validate date inputs
  if (!fromDate || !toDate) {
    return res.json({ success: false, error: 'Both from and to dates are required' });
  }
  
  // Convert isSpecial string to boolean properly
  const useSpecialTable = isSpecial === 'true';
  
  // Determine which table to use based on the toggle
  const tableName = useSpecialTable ? 'S_Release_Records' : 'Release_Records';
  
  const query = `SELECT * FROM ${tableName} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  
  db.all(query, [fromDate, toDate], (err, records) => {
    if (err) {
      console.error(`Error fetching data from ${tableName}:`, err.message);
      return res.json({ success: false, error: err.message });
    }
    
    // Group records by date
    const groupedRecords = {};
    
    records.forEach(record => {
      const date = record.Date;
      
      if (!groupedRecords[date]) {
        groupedRecords[date] = [];
      }
      
      groupedRecords[date].push(record);
    });
    
    res.json({ success: true, groupedRecords });
  });
});

// Generate Excel file for Release Records
// Update your release-records-excel route to handle column selection
app.get('/release-records-excel', (req, res) => {
  const { fromDate, toDate, isSpecial, columns } = req.query;
  
  // Validate inputs
  if (!fromDate || !toDate) {
    return res.status(400).send('Missing required parameters');
  }
  
  // Convert isSpecial string to boolean properly
  const useSpecialTable = isSpecial === 'true';
  
  // Determine which table to use based on the toggle
  const tableName = useSpecialTable ? 'S_Release_Records' : 'Release_Records';
  
  const query = `SELECT * FROM ${tableName} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  
  db.all(query, [fromDate, toDate], (err, records) => {
    if (err) {
      console.error(`Error fetching data from ${tableName}:`, err.message);
      return res.status(500).send('Database error');
    }
    
    // Group records by date (like in the display function)
    const groupedRecords = {};
    
    records.forEach(record => {
      const date = record.Date;
      
      if (!groupedRecords[date]) {
        groupedRecords[date] = [];
      }
      
      groupedRecords[date].push(record);
    });
    
    // Process the data based on selected columns
    const selectedColumns = columns ? columns.split(',') : ['Date', 'BillNumber', 'ReleaseAmount', 'GoldWeight', 'SilverWeight', 'DailyTotal'];
    
    // Create a workbook using a library like ExcelJS or xlsx
    // This is just a placeholder - you'll need to implement the actual Excel generation
    // based on your existing Excel generation code and the selected columns
    
    // Example with ExcelJS:
    const Excel = require('exceljs');
    const workbook = new Excel.Workbook();
    const worksheet = workbook.addWorksheet('Release Records');
    
    // Add headers based on selected columns
    const headers = [];
    if (selectedColumns.includes('Date')) headers.push('Date');
    if (selectedColumns.includes('BillNumber')) headers.push('Bill Numbers');
    if (selectedColumns.includes('ReleaseAmount')) headers.push('Release Amounts');
    if (selectedColumns.includes('GoldWeight')) headers.push('Gold Weight (g)');
    if (selectedColumns.includes('SilverWeight')) headers.push('Silver Weight (g)');
    if (selectedColumns.includes('DailyTotal')) headers.push('Daily Total');
    
    worksheet.addRow(headers);
    
    // Add data rows based on selected columns
    const sortedDates = Object.keys(groupedRecords).sort((a, b) => new Date(a) - new Date(b));
    
    sortedDates.forEach(date => {
      const records = groupedRecords[date];
      
      // Calculate daily totals
      let dailyTotal = 0;
      let totalGoldWeight = 0;
      let totalSilverWeight = 0;
      let billNumbers = [];
      let releaseAmounts = [];
      
      records.forEach(record => {
        billNumbers.push(record['Bill No']);
        releaseAmounts.push(record['Release Amount']);
        dailyTotal += record['Release Amount'];
        totalGoldWeight += record['Released Gold Weight'];
        totalSilverWeight += record['Released Silver Weight'];
      });
      
      // Format date for display
      const dateObj = new Date(date);
      const formattedDate = dateObj.toLocaleDateString('en-GB');
      
      // Add row data based on selected columns
      const rowData = [];
      if (selectedColumns.includes('Date')) rowData.push(formattedDate);
      if (selectedColumns.includes('BillNumber')) rowData.push(billNumbers.join(', '));
      if (selectedColumns.includes('ReleaseAmount')) rowData.push(releaseAmounts.join(', '));
      if (selectedColumns.includes('GoldWeight')) rowData.push(totalGoldWeight);
      if (selectedColumns.includes('SilverWeight')) rowData.push(totalSilverWeight);
      if (selectedColumns.includes('DailyTotal')) rowData.push(dailyTotal);
      
      worksheet.addRow(rowData);
    });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=ReleaseRecords-${fromDate}-to-${toDate}.xlsx`);
    
    // Write to response stream
    workbook.xlsx.write(res)
      .then(() => {
        res.end();
      })
      .catch(err => {
        console.error('Error generating Excel:', err);
        res.status(500).send('Error generating Excel file');
      });
  });
});
// Day Book Route
// Day Book routes
app.get('/day-book', (req, res) => {
  res.render('dayBook');
});

// API to fetch Day Book data
app.get('/day-book-data', (req, res) => {
  const { fromDate, toDate, isSpecial } = req.query;
  const tableName = isSpecial === 'true' ? 'S_Day_Book' : 'Day_Book';
  const expensesTable = isSpecial === 'true' ? 'S_Expenses' : 'Expenses';
  
  // Validate date inputs
  if (!fromDate || !toDate) {
    return res.json({ success: false, error: 'Both from and to dates are required' });
  }
  
  const dayBookQuery = `SELECT * FROM ${tableName} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  const expensesQuery = `SELECT Date, "Total Expense" FROM ${expensesTable} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  
  // Get both day book and expense records
  Promise.all([
    new Promise((resolve, reject) => {
      db.all(dayBookQuery, [fromDate, toDate], (err, records) => {
        if (err) {
          console.error(`Error fetching data from ${tableName}:`, err.message);
          reject(err);
        } else {
          resolve(records);
        }
      });
    }),
    new Promise((resolve, reject) => {
      db.all(expensesQuery, [fromDate, toDate], (err, records) => {
        if (err) {
          console.error(`Error fetching data from ${expensesTable}:`, err.message);
          reject(err);
        } else {
          resolve(records);
        }
      });
    })
  ])
  .then(([dayBookRecords, expenseRecords]) => {
    // Process the results to ensure all dates with expenses are included
    const combinedRecords = {};
    
    // First, add all day book records to the combined records
    dayBookRecords.forEach(record => {
      combinedRecords[record.Date] = {
        Date: record.Date,
        'Pledge Amount': record['Pledge Amount'] || 0,
        'Release Amount': record['Release Amount'] || 0,
        'Interest Received': record['Interest Received'] || 0,
        'Additional Interest Received': record['Additional Interest Received'] || 0,
        'Expense': 0 // Default expense to 0
      };
    });
    
    // Then, add all expense records (creating day book records with zeros if they don't exist)
    expenseRecords.forEach(expense => {
      if (!combinedRecords[expense.Date]) {
        combinedRecords[expense.Date] = {
          Date: expense.Date,
          'Pledge Amount': 0,
          'Release Amount': 0,
          'Interest Received': 0,
          'Additional Interest Received': 0,
          'Expense': expense['Total Expense'] || 0
        };
      } else {
        combinedRecords[expense.Date]['Expense'] = expense['Total Expense'] || 0;
      }
    });
    
    // Convert combined records object to array
    const finalRecords = Object.values(combinedRecords);
    
    // Sort by date
    finalRecords.sort((a, b) => new Date(a.Date) - new Date(b.Date));
    
    res.json({ 
      success: true, 
      records: finalRecords
    });
  })
  .catch(error => {
    res.json({ success: false, error: error.message });
  });
});

// Generate Excel file for Day Book
app.get('/day-book-excel', (req, res) => {
  const { fromDate, toDate, openingBalance, isSpecial } = req.query;
  const tableName = isSpecial === 'true' ? 'S_Day_Book' : 'Day_Book';
  const expensesTable = isSpecial === 'true' ? 'S_Expenses' : 'Expenses';
  
  // Validate inputs
  if (!fromDate || !toDate || !openingBalance) {
    return res.status(400).send('Missing required parameters');
  }
  
  const dayBookQuery = `SELECT * FROM ${tableName} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  const expensesQuery = `SELECT Date, "Total Expense" FROM ${expensesTable} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  
  // Get both data sets
  Promise.all([
    new Promise((resolve, reject) => {
      db.all(dayBookQuery, [fromDate, toDate], (err, records) => {
        if (err) {
          console.error(`Error fetching data from ${tableName}:`, err.message);
          reject(err);
        } else {
          resolve(records);
        }
      });
    }),
    new Promise((resolve, reject) => {
      db.all(expensesQuery, [fromDate, toDate], (err, records) => {
        if (err) {
          console.error(`Error fetching data from ${expensesTable}:`, err.message);
          reject(err);
        } else {
          resolve(records);
        }
      });
    })
  ])
  .then(([dayBookRecords, expenseRecords]) => {
    // Process the results to ensure all dates with expenses are included
    const combinedRecords = {};
    
    // First, add all day book records to the combined records
    dayBookRecords.forEach(record => {
      combinedRecords[record.Date] = {
        Date: record.Date,
        'Pledge Amount': record['Pledge Amount'] || 0,
        'Release Amount': record['Release Amount'] || 0,
        'Interest Received': record['Interest Received'] || 0,
        'Additional Interest Received': record['Additional Interest Received'] || 0,
        'Expense': 0 // Default expense to 0
      };
    });
    
    // Then, add all expense records (creating day book records with zeros if they don't exist)
    expenseRecords.forEach(expense => {
      if (!combinedRecords[expense.Date]) {
        combinedRecords[expense.Date] = {
          Date: expense.Date,
          'Pledge Amount': 0,
          'Release Amount': 0,
          'Interest Received': 0,
          'Additional Interest Received': 0,
          'Expense': expense['Total Expense'] || 0
        };
      } else {
        combinedRecords[expense.Date]['Expense'] = expense['Total Expense'] || 0;
      }
    });
    
    // Convert combined records object to array
    const finalRecords = Object.values(combinedRecords);
    
    // Sort by date
    finalRecords.sort((a, b) => new Date(a.Date) - new Date(b.Date));
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Day Book');
    
    // Define columns
    worksheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Opening Balance', key: 'openingBalance', width: 20 },
      { header: 'Pledge Amount', key: 'pledgeAmount', width: 15 },
      { header: 'Release Amount', key: 'releaseAmount', width: 15 },
      { header: 'Interest Received', key: 'interestReceived', width: 20 },
      { header: 'Interest Against Expenses', key: 'additionalInterestReceived', width: 25 },
      { header: 'Operating / Shop\'s Expense', key: 'shopExpense', width: 15 },
      { header: 'Total', key: 'total', width: 15 },
      { header: 'Closing Balance', key: 'closingBalance', width: 20 }
    ];
    
    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };
    
    // Add data to the worksheet
    let runningBalance = parseFloat(openingBalance);
    let totalPledge = 0;
    let totalRelease = 0;
    let totalInterest = 0;
    let totalAdditionalInterest = 0;
    let totalExpense = 0;
    
    // Track the first opening balance and last closing balance
    const firstOpeningBalance = runningBalance;
    let lastClosingBalance = runningBalance;
    
    finalRecords.forEach((record) => {
      const pledgeAmount = record['Pledge Amount'] || 0;
      const releaseAmount = record['Release Amount'] || 0;
      const interestReceived = record['Interest Received'] || 0;
      const additionalInterestReceived = record['Additional Interest Received'] || 0;
      const expense = record['Expense'] || 0;
      
      // Calculate total based on the new formula: Release + Interest + Interest on Expense - Expense - Pledge
      const total = releaseAmount + interestReceived + additionalInterestReceived - expense - pledgeAmount;
      const closingBalance = runningBalance + total;
      
      // Update totals for summary
      totalPledge += pledgeAmount;
      totalRelease += releaseAmount;
      totalInterest += interestReceived;
      totalAdditionalInterest += additionalInterestReceived;
      totalExpense += expense;
      
      // Format date for display
      const dateObj = new Date(record.Date);
      const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-${dateObj.getFullYear()}`;
      
      worksheet.addRow({
        date: formattedDate,
        openingBalance: runningBalance,
        pledgeAmount: pledgeAmount,
        releaseAmount: releaseAmount,
        interestReceived: interestReceived,
        additionalInterestReceived: additionalInterestReceived,
        shopExpense: expense,
        total: total,
        closingBalance: closingBalance
      });
      
      // Update running balance for next row
      runningBalance = closingBalance;
      lastClosingBalance = closingBalance;
    });
    
    // Add empty row
    worksheet.addRow({});
    
    // Add summary row
    const summaryRow = worksheet.addRow({
      date: 'Summary',
      openingBalance: firstOpeningBalance,
      pledgeAmount: totalPledge,
      releaseAmount: totalRelease,
      interestReceived: totalInterest,
      additionalInterestReceived: totalAdditionalInterest,
      shopExpense: totalExpense,
      total: totalRelease + totalInterest + totalAdditionalInterest - totalExpense - totalPledge,
      closingBalance: lastClosingBalance
    });
    
    // Style summary row
    summaryRow.font = { bold: true };
    summaryRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEEEEEE' }
    };
    
    // Add title with date range
    worksheet.insertRow(1, [`${tableName} - ${fromDate} to ${toDate}`]);
    worksheet.mergeCells('A1:I1');
    const titleRow = worksheet.getRow(1);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { horizontal: 'center' };
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${tableName}_${fromDate}_to_${toDate}.xlsx`);
    
    // Write workbook to response
    workbook.xlsx.write(res)
      .then(() => {
        console.log('Excel file sent successfully');
      })
      .catch(error => {
        console.error('Error generating Excel:', error);
        res.status(500).send('Error generating Excel file');
      });
  })
  .catch(error => {
    console.error('Error:', error);
    res.status(500).send('Database error');
  });
});

app.get('/export-excel', (req, res) => {
  // Get the series type from query parameters or default to standard
  const seriesType = req.query.seriesType === 'S' ? 'S' : 'standard';
  
  // Apply the same filters as in the POST /insights route
  const ageFilter = req.query.ageFilter;
  const customStartDate = req.query.customStartDate;
  const customEndDate = req.query.customEndDate;
  const repaymentStatus = req.query.repaymentStatus;
  
  // Determine which tables to query based on seriesType
  const activePledgesTable = seriesType === 'S' ? 'S_active_pledges' : 'active_pledges';
  
  // Build the query based on filters
  let query = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Gold/Silver", "No_of_items", "Items", 
           "Initial Pledged Amount", "Principle_Adding_His", "Repay History"
    FROM ${activePledgesTable}
  `;
  
  let whereConditions = [];
  let params = [];
  
  // Apply age filter
  if (ageFilter) {
    const today = new Date();
    let filterDate = new Date();
    
    if (ageFilter === 'custom' && customStartDate && customEndDate) {
      // For custom date range, we'll filter bills between these dates
      whereConditions.push(`"Date" BETWEEN ? AND ?`);
      params.push(customStartDate, customEndDate);
    } else {
      // For predefined age filters
      switch(ageFilter) {
        case '3years':
          filterDate.setFullYear(today.getFullYear() - 3);
          break;
        case '2years':
          filterDate.setFullYear(today.getFullYear() - 2);
          break;
        case '1year':
          filterDate.setFullYear(today.getFullYear() - 1);
          break;
        case '6months':
          filterDate.setMonth(today.getMonth() - 6);
          break;
      }
      
      if (ageFilter !== 'custom') {
        // Format date as YYYY-MM-DD
        const formattedDate = filterDate.toISOString().split('T')[0];
        whereConditions.push(`"Date" <= ?`);
        params.push(formattedDate);
      }
    }
  }
  
  // Apply repayment status filter
  if (repaymentStatus) {
    switch(repaymentStatus) {
      case 'noRepayment':
        whereConditions.push(`("Repay History" IS NULL OR "Repay History" = '{}' OR "Repay History" = '')`);
        break;
      case 'hasRepayment':
        whereConditions.push(`"Repay History" IS NOT NULL AND "Repay History" != '{}' AND "Repay History" != ''`);
        break;
      case 'noPrincipal':
        whereConditions.push(`("Principle_Adding_His" IS NULL OR "Principle_Adding_His" = '{}' OR "Principle_Adding_His" = '')`);
        break;
      case 'hasPrincipal':
        whereConditions.push(`"Principle_Adding_His" IS NOT NULL AND "Principle_Adding_His" != '{}' AND "Principle_Adding_His" != ''`);
        break;
    }
  }
  
  // Add WHERE clause if conditions exist
  if (whereConditions.length > 0) {
    query += ' WHERE ' + whereConditions.join(' AND ');
  }
  
  // Order by date (oldest first to match the age filtering)
  query += ' ORDER BY "Date" ASC';
  
  // Execute the query
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error exporting to Excel:', err.message);
      return res.status(500).send('Error exporting data: ' + err.message);
    }
    
    // Create Excel workbook using ExcelJS instead of xlsx
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bills');
    
    // Define columns with proper styling
    worksheet.columns = [
      { header: 'Bill No', key: 'billNumber', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Phone Number', key: 'phoneNumber', width: 15 },
      { header: 'Material', key: 'material', width: 12 },
      { header: 'Pledge Date', key: 'date', width: 15 },
      { header: 'Pledge Amount', key: 'pledgeAmount', width: 15 },
      { header: 'Items', key: 'items', width: 35 },
      { header: 'Principal Added', key: 'principalAdded', width: 30 },
      { header: 'Repay History', key: 'repayHistory', width: 30 },
      { header: 'Age (Years, Months)', key: 'age', width: 20 }
    ];
    
    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };
    
    // Process and add data rows
    rows.forEach(bill => {
      // Parse JSON fields
      let items = {};
      let principalAdditions = {};
      let repayHistory = {};
      
      try {
        if (bill.Items && typeof bill.Items === 'string') {
          items = JSON.parse(bill.Items);
        }
        if (bill.Principle_Adding_His && typeof bill.Principle_Adding_His === 'string') {
          principalAdditions = JSON.parse(bill.Principle_Adding_His);
        }
        if (bill["Repay History"] && typeof bill["Repay History"] === 'string') {
          repayHistory = JSON.parse(bill["Repay History"]);
        }
      } catch (e) {
        console.error('Error parsing JSON for Excel export:', e.message);
      }
      
      // Format items as key:value,key:value
      let formattedItems = '';
      if (typeof items === 'object' && Object.keys(items).length > 0) {
        formattedItems = Object.entries(items).map(([key, value]) => `${key}:${value}`).join(', ');
      }
      
      // Format principal additions as key:value,key:value
      let formattedPrincipalAdditions = '';
      if (typeof principalAdditions === 'object' && Object.keys(principalAdditions).length > 0) {
        formattedPrincipalAdditions = Object.entries(principalAdditions).map(([date, amount]) => `${date}:₹${amount}`).join(', ');
      }
      
      // Format repayment history as key:value,key:value
      let formattedRepayHistory = '';
      if (typeof repayHistory === 'object' && Object.keys(repayHistory).length > 0) {
        formattedRepayHistory = Object.entries(repayHistory).map(([date, amount]) => `${date}:₹${amount}`).join(', ');
      }
      
      // Calculate bill age
      const pledgeDate = new Date(bill.Date);
      const today = new Date();
      const yearDiff = today.getFullYear() - pledgeDate.getFullYear();
      let monthDiff = today.getMonth() - pledgeDate.getMonth();
      
      if (monthDiff < 0) {
        monthDiff += 12;
      }
      
      // Format date
      const formattedDate = new Date(bill.Date).toLocaleDateString('en-GB');
      
      // Add row to worksheet
      worksheet.addRow({
        billNumber: bill["Bill Number"],
        name: bill.Name,
        phoneNumber: bill["Phone Number"],
        material: bill["Gold/Silver"],
        date: formattedDate,
        pledgeAmount: bill["Initial Pledged Amount"],
        items: formattedItems,
        principalAdded: formattedPrincipalAdditions,
        repayHistory: formattedRepayHistory,
        age: `${yearDiff} years, ${monthDiff} months`
      });
    });
    
    // Add title with filter information
    const filterInfo = [];
    if (ageFilter) {
      if (ageFilter === 'custom' && customStartDate && customEndDate) {
        filterInfo.push(`Date Range: ${customStartDate} to ${customEndDate}`);
      } else {
        filterInfo.push(`Age Filter: ${ageFilter}`);
      }
    }
    if (repaymentStatus) {
      filterInfo.push(`Status: ${repaymentStatus}`);
    }
    
    const titleText = `${seriesType === 'S' ? 'S Series' : 'Standard Series'} Bills ${filterInfo.length > 0 ? '- ' + filterInfo.join(', ') : ''}`;
    
    worksheet.insertRow(1, [titleText]);
    worksheet.mergeCells('A1:J1');
    const titleRow = worksheet.getRow(1);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { horizontal: 'center' };
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=bills_${seriesType}_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    // Write workbook to response
    workbook.xlsx.write(res)
      .then(() => {
        console.log('Excel file sent successfully');
      })
      .catch(error => {
        console.error('Error generating Excel:', error);
        res.status(500).send('Error generating Excel file');
      });
  });
});

// GET: Display insights page with filters
app.get('/insights', (req, res) => {
  // Get the series type from query parameters or default to standard
  const seriesType = req.query.seriesType === 'S' ? 'S' : 'standard';
  
  // First, get the reserve data (gold and silver in reserve)
  const reserveQuery = seriesType === 'S' 
    ? `SELECT * FROM S_Insights_gold_silver`
    : `SELECT * FROM Insights_gold_silver`;
  
  db.get(reserveQuery, [], (err, reserveData) => {
    if (err) {
      console.error('Error fetching reserve data:', err.message);
      return res.render('insights', { bills: [], reserveData: {}, error: 'Error fetching reserve data' });
    }
    
    // Initially just render the page with reserve data but no bills
    res.render('insights', { 
      bills: [], 
      reserveData: reserveData || {}, 
      seriesType: seriesType,
      filters: {},
      error: null 
    });
  });
});

// POST: Handle filtering and querying bills
app.post('/insights', (req, res) => {
  // Get filter parameters from the request body
  const { 
    seriesType,
    ageFilter, 
    customStartDate, 
    customEndDate,
    repaymentStatus
  } = req.body;
  
  // Store filters for re-rendering the form
  const filters = {
    ageFilter,
    customStartDate,
    customEndDate,
    repaymentStatus
  };
  
  // First, get the reserve data
  const reserveQuery = seriesType === 'S' 
    ? `SELECT * FROM S_Insights_gold_silver`
    : `SELECT * FROM Insights_gold_silver`;
  
  db.get(reserveQuery, [], (err, reserveData) => {
    if (err) {
      console.error('Error fetching reserve data:', err.message);
      return res.render('insights', { 
        bills: [], 
        reserveData: {}, 
        seriesType,
        filters,
        error: 'Error fetching reserve data' 
      });
    }
    
    // Determine which tables to query based on seriesType
    const activePledgesTable = seriesType === 'S' ? 'S_active_pledges' : 'active_pledges';
    
    // Build the query based on filters
    let query = `
      SELECT "Bill Number", "Name", "Date", "Phone Number", "Gold/Silver", "No_of_items", "Items", 
             "Initial Pledged Amount", "Principle_Adding_His", "Repay History"
      FROM ${activePledgesTable}
    `;
    
    let whereConditions = [];
    let params = [];
    
    // Apply age filter
    if (ageFilter) {
      const today = new Date();
      let filterDate = new Date();
      
      if (ageFilter === 'custom' && customStartDate && customEndDate) {
        // For custom date range, we'll filter bills between these dates
        whereConditions.push(`"Date" BETWEEN ? AND ?`);
        params.push(customStartDate, customEndDate);
      } else {
        // For predefined age filters
        switch(ageFilter) {
          case '3years':
            filterDate.setFullYear(today.getFullYear() - 3);
            break;
          case '2years':
            filterDate.setFullYear(today.getFullYear() - 2);
            break;
          case '1year':
            filterDate.setFullYear(today.getFullYear() - 1);
            break;
          case '6months':
            filterDate.setMonth(today.getMonth() - 6);
            break;
        }
        
        if (ageFilter !== 'custom') {
          // Format date as YYYY-MM-DD
          const formattedDate = filterDate.toISOString().split('T')[0];
          whereConditions.push(`"Date" <= ?`);
          params.push(formattedDate);
        }
      }
    }
    
    // Apply repayment status filter
    if (repaymentStatus) {
      switch(repaymentStatus) {
        case 'noRepayment':
          whereConditions.push(`("Repay History" IS NULL OR "Repay History" = '{}' OR "Repay History" = '')`);
          break;
        case 'hasRepayment':
          whereConditions.push(`"Repay History" IS NOT NULL AND "Repay History" != '{}' AND "Repay History" != ''`);
          break;
        case 'noPrincipal':
          whereConditions.push(`("Principle_Adding_His" IS NULL OR "Principle_Adding_His" = '{}' OR "Principle_Adding_His" = '')`);
          break;
        case 'hasPrincipal':
          whereConditions.push(`"Principle_Adding_His" IS NOT NULL AND "Principle_Adding_His" != '{}' AND "Principle_Adding_His" != ''`);
          break;
        case 'hasBoth':
          whereConditions.push(`"Principle_Adding_His" IS NOT NULL AND "Principle_Adding_His" != '{}' AND "Principle_Adding_His" != '' AND "Repay History" IS NOT NULL AND "Repay History" != '{}' AND "Repay History" != ''`);
          break;
      }
    }
    
    // Add WHERE clause if conditions exist
    if (whereConditions.length > 0) {
      query += ' WHERE ' + whereConditions.join(' AND ');
    }
    
    // Order by date (oldest first to match the age filtering)
    query += ' ORDER BY "Date" ASC';
    
    // Execute the query
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Error fetching bills data:', err.message);
        return res.render('insights', { 
          bills: [], 
          reserveData: reserveData || {}, 
          seriesType,
          filters,
          error: 'Error fetching bills data: ' + err.message 
        });
      }
      
      // Process the bills to calculate their ages and format JSON fields
      const processedBills = rows.map(bill => {
        // Calculate bill age
        const pledgeDate = new Date(bill.Date);
        const today = new Date();
        const yearDiff = today.getFullYear() - pledgeDate.getFullYear();
        let monthDiff = today.getMonth() - pledgeDate.getMonth();
        
        if (monthDiff < 0) {
          monthDiff += 12;
        }
        
        // Parse JSON fields
        let items = {};
        let principalAdditions = {};
        let repayHistory = {};
        
        try {
          if (bill.Items && typeof bill.Items === 'string') {
            items = JSON.parse(bill.Items);
          }
          if (bill.Principle_Adding_His && typeof bill.Principle_Adding_His === 'string') {
            principalAdditions = JSON.parse(bill.Principle_Adding_His);
          }
          if (bill["Repay History"] && typeof bill["Repay History"] === 'string') {
            repayHistory = JSON.parse(bill["Repay History"]);
          }
        } catch (e) {
          console.error('Error parsing JSON:', e.message);
        }
        
        return {
          ...bill,
          Items: items,
          Principle_Adding_His: principalAdditions,
          "Repay History": repayHistory,
          age: {
            years: yearDiff,
            months: monthDiff
          }
        };
      });
      
      // Render the insights page with the processed bills
      res.render('insights', { 
        bills: processedBills, 
        reserveData: reserveData || {}, 
        seriesType,
        filters,
        error: null
      });
    });
  });
});
// Route to render the Ledger page
// Route to render the ledger page
app.get('/ledger', (req, res) => {
  res.render('ledger');
});

// API to fetch Ledger data with improved search functionality
app.get('/ledger-data', (req, res) => {
  const { isSpecial, searchType, fromDate, toDate, seriesName, pledgeNoFrom, pledgeNoTo } = req.query;
  const tableName = isSpecial === 'true' ? 'S_Ledger' : 'Ledger';
  
  let query = '';
  let params = [];
  
  if (searchType === 'date') {
    // Validate date inputs
    if (!fromDate || !toDate) {
      return res.json({ success: false, error: 'Both from and to dates are required' });
    }
    
    query = `SELECT * FROM ${tableName} WHERE pledge_date >= ? AND pledge_date <= ? ORDER BY pledge_date ASC`;
    params = [fromDate, toDate];
  } else if (searchType === 'series') {
    // Validate series inputs
    if (!seriesName) {
      return res.json({ success: false, error: 'Series name is required' });
    }
    
    if (pledgeNoFrom && pledgeNoTo) {
      query = `SELECT * FROM ${tableName} WHERE series = ? AND pledge_no >= ? AND pledge_no <= ? ORDER BY pledge_no ASC`;
      params = [seriesName, pledgeNoFrom, pledgeNoTo];
    } else if (pledgeNoFrom) {
      query = `SELECT * FROM ${tableName} WHERE series = ? AND pledge_no >= ? ORDER BY pledge_no ASC`;
      params = [seriesName, pledgeNoFrom];
    } else if (pledgeNoTo) {
      query = `SELECT * FROM ${tableName} WHERE series = ? AND pledge_no <= ? ORDER BY pledge_no ASC`;
      params = [seriesName, pledgeNoTo];
    } else {
      query = `SELECT * FROM ${tableName} WHERE series = ? ORDER BY pledge_no ASC`;
      params = [seriesName];
    }
  } else {
    return res.json({ success: false, error: 'Invalid search type' });
  }
  
  db.all(query, params, (err, records) => {
    if (err) {
      console.error(`Error fetching data from ${tableName}:`, err.message);
      return res.json({ success: false, error: err.message });
    }
    
    res.json({ 
      success: true, 
      records: records
    });
  });
});

// Generate Excel file for Ledger with improved functionality
// Generate Excel file for Ledger with improved functionality
app.get('/ledger-excel', (req, res) => {
  const { isSpecial, searchType, fromDate, toDate, seriesName, pledgeNoFrom, pledgeNoTo } = req.query;
  const tableName = isSpecial === 'true' ? 'S_Ledger' : 'Ledger';
  
  let query = '';
  let params = [];
  let filenameSuffix = '';
  
  if (searchType === 'date') {
    // Validate date inputs
    if (!fromDate || !toDate) {
      return res.status(400).send('Missing required date parameters');
    }
    
    query = `SELECT * FROM ${tableName} WHERE pledge_date >= ? AND pledge_date <= ? ORDER BY pledge_date ASC`;
    params = [fromDate, toDate];
    filenameSuffix = `${fromDate}_to_${toDate}`;
  } else if (searchType === 'series') {
    // Validate series inputs
    if (!seriesName) {
      return res.status(400).send('Series name is required');
    }
    
    if (pledgeNoFrom && pledgeNoTo) {
      query = `SELECT * FROM ${tableName} WHERE series = ? AND pledge_no >= ? AND pledge_no <= ? ORDER BY pledge_no ASC`;
      params = [seriesName, pledgeNoFrom, pledgeNoTo];
      filenameSuffix = `Series_${seriesName}_${pledgeNoFrom}_to_${pledgeNoTo}`;
    } else if (pledgeNoFrom) {
      query = `SELECT * FROM ${tableName} WHERE series = ? AND pledge_no >= ? ORDER BY pledge_no ASC`;
      params = [seriesName, pledgeNoFrom];
      filenameSuffix = `Series_${seriesName}_from_${pledgeNoFrom}`;
    } else if (pledgeNoTo) {
      query = `SELECT * FROM ${tableName} WHERE series = ? AND pledge_no <= ? ORDER BY pledge_no ASC`;
      params = [seriesName, pledgeNoTo];
      filenameSuffix = `Series_${seriesName}_to_${pledgeNoTo}`;
    } else {
      query = `SELECT * FROM ${tableName} WHERE series = ? ORDER BY pledge_no ASC`;
      params = [seriesName];
      filenameSuffix = `Series_${seriesName}`;
    }
  } else {
    return res.status(400).send('Invalid search type');
  }
  
  db.all(query, params, (err, records) => {
    if (err) {
      console.error(`Error fetching data from ${tableName}:`, err.message);
      return res.status(500).send('Database error');
    }
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Ledger');
    
    // Define columns - Reordered with "Pledge Date" after Pledge No
    worksheet.columns = [
      { header: 'Series', key: 'series', width: 10 },
      { header: 'Pledge No', key: 'pledgeNo', width: 10 },
      { header: 'Pledge Date', key: 'pledgeDate', width: 15 }, // Renamed and reordered
      { header: 'Name and Address', key: 'nameAndAddress', width: 30 },
      { header: 'Principal Amount', key: 'principalAmount', width: 15 },
      { header: 'Interest (%)', key: 'interest', width: 12 },
      { header: 'Item Description', key: 'itemDescription', width: 30 },
      { header: 'Weights', key: 'weights', width: 20 },
      { header: 'Value', key: 'value', width: 15 },
      { header: 'Time Agreed (months)', key: 'timeAgreed', width: 15 },
      { header: 'Release Date', key: 'releaseDate', width: 15 },
      { header: 'H Form No', key: 'hFormNo', width: 15 },
      { header: 'Principal', key: 'principal', width: 15 },
      { header: 'Interest Amount', key: 'interestAmount', width: 15 }
    ];
    
    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };
    
    // Helper function to parse JSON safely
    function parseJsonSafely(jsonString) {
      try {
        return JSON.parse(jsonString);
      } catch (e) {
        return null;
      }
    }
    
    // Helper function to format JSON properties for Excel
    function formatJsonPropertyForExcel(jsonStr) {
      const details = parseJsonSafely(jsonStr);
      if (!details) return jsonStr || '';
      
      let formattedText = '';
      for (const [key, value] of Object.entries(details)) {
        formattedText += `${key}: ${value}\n`;
      }
      return formattedText.trim();
    }
    
    // Define a fixed row height (approximately 3 lines of text)
    const fixedRowHeight = 60;
    
    // Process each record for Excel
    records.forEach((record, rowIndex) => {
      // Format dates
      let formattedDate = '';
      if (record.pledge_date) {
        const dateObj = new Date(record.pledge_date);
        formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-${dateObj.getFullYear()}`;
      }
      
      let formattedReleaseDate = '';
      if (record.release_date) {
        const releaseDateObj = new Date(record.release_date);
        formattedReleaseDate = `${releaseDateObj.getDate().toString().padStart(2, '0')}-${(releaseDateObj.getMonth() + 1).toString().padStart(2, '0')}-${releaseDateObj.getFullYear()}`;
      }
      
      // Format JSON properties
      const itemDescription = formatJsonPropertyForExcel(record.item_description);
      const weights = formatJsonPropertyForExcel(record.weights);
      
      // Format combined name and address
      let nameAndAddress = '';
      if (record.name) {
        nameAndAddress += record.name;
      }
      if (record.father_spouse_name) {
        if (nameAndAddress) nameAndAddress += '\nS/W of ' + record.father_spouse_name;
        else nameAndAddress += record.father_spouse_name;
      }
      if (record.town_city) {
        if (nameAndAddress) nameAndAddress += '\n' + record.town_city;
        else nameAndAddress += record.town_city;
      }
      
      // Add data row with new column order
      const row = worksheet.addRow({
        series: record.series || '',
        pledgeNo: record.pledge_no || '',
        pledgeDate: formattedDate,  // Renamed key
        nameAndAddress: nameAndAddress,
        principalAmount: record.principal_amount || 0,
        interest: record.interest || '',
        itemDescription: itemDescription,
        weights: weights,
        value: record.value || 0,
        timeAgreed: record.time_agreed || '',
        releaseDate: formattedReleaseDate,
        hFormNo: record.h_from_no || '',
        principal: record.principal || 0,
        interestAmount: record.interest_amount || 0
      });
      
      // Set fixed row height instead of auto-height
      row.height = fixedRowHeight;
      
      // Apply number format for currency cells (starting from row 2)
      const rowNum = rowIndex + 2; // +2 because row 1 is header and we're 0-indexed
      worksheet.getCell(`E${rowNum}`).numFmt = '#,##0.00'; // Principal Amount
      worksheet.getCell(`I${rowNum}`).numFmt = '#,##0.00'; // Value
      worksheet.getCell(`M${rowNum}`).numFmt = '#,##0.00'; // Principal
      worksheet.getCell(`N${rowNum}`).numFmt = '#,##0.00'; // Interest Amount
      
      // Set text wrap for the combined name/address cell
      const nameAddressCell = worksheet.getCell(`D${rowNum}`);
      nameAddressCell.alignment = { wrapText: true, vertical: 'top' };
    });
    
    // Set file name based on type of search
    const fileName = isSpecial === 'true' ? 
      `S_Ledger_${filenameSuffix}.xlsx` : 
      `Ledger_${filenameSuffix}.xlsx`;
    
    // Set content type and headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    
    // Write workbook to response
    workbook.xlsx.write(res)
      .then(() => {
        console.log(`Excel file ${fileName} generated successfully`);
      })
      .catch(err => {
        console.error('Error generating Excel file:', err);
        res.status(500).send('Error generating Excel file');
      });
  });
});

// Generate PDF file for Day Book
app.get('/day-book-pdf', (req, res) => {
  const { fromDate, toDate, openingBalance, isSpecial } = req.query;
  const tableName = isSpecial === 'true' ? 'S_Day_Book' : 'Day_Book';
  const expensesTable = isSpecial === 'true' ? 'S_Expenses' : 'Expenses';
  
  // Validate inputs
  if (!fromDate || !toDate || !openingBalance) {
    return res.status(400).send('Missing required parameters');
  }
  
  const dayBookQuery = `SELECT * FROM ${tableName} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  const expensesQuery = `SELECT Date, "Total Expense" FROM ${expensesTable} WHERE Date >= ? AND Date <= ? ORDER BY Date ASC`;
  
  // Get both data sets
  Promise.all([
    new Promise((resolve, reject) => {
      db.all(dayBookQuery, [fromDate, toDate], (err, records) => {
        if (err) {
          console.error(`Error fetching data from ${tableName}:`, err.message);
          reject(err);
        } else {
          resolve(records);
        }
      });
    }),
    new Promise((resolve, reject) => {
      db.all(expensesQuery, [fromDate, toDate], (err, records) => {
        if (err) {
          console.error(`Error fetching data from ${expensesTable}:`, err.message);
          reject(err);
        } else {
          resolve(records);
        }
      });
    })
  ])
  .then(([dayBookRecords, expenseRecords]) => {
    // Process the results to ensure all dates with expenses are included
    const combinedRecords = {};
    
    // First, add all day book records to the combined records
    dayBookRecords.forEach(record => {
      combinedRecords[record.Date] = {
        Date: record.Date,
        'Pledge Amount': record['Pledge Amount'] || 0,
        'Release Amount': record['Release Amount'] || 0,
        'Interest Received': record['Interest Received'] || 0,
        'Additional Interest Received': record['Additional Interest Received'] || 0,
        'Expense': 0 // Default expense to 0
      };
    });
    
    // Then, add all expense records (creating day book records with zeros if they don't exist)
    expenseRecords.forEach(expense => {
      if (!combinedRecords[expense.Date]) {
        combinedRecords[expense.Date] = {
          Date: expense.Date,
          'Pledge Amount': 0,
          'Release Amount': 0,
          'Interest Received': 0,
          'Additional Interest Received': 0,
          'Expense': expense['Total Expense'] || 0
        };
      } else {
        combinedRecords[expense.Date]['Expense'] = expense['Total Expense'] || 0;
      }
    });
    
    // Convert combined records object to array
    const finalRecords = Object.values(combinedRecords);
    
    // Sort by date
    finalRecords.sort((a, b) => new Date(a.Date) - new Date(b.Date));
    
    // Create PDF document
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${tableName}_${fromDate}_to_${toDate}.pdf`);
    
    // Pipe the PDF to the response
    doc.pipe(res);
    
    // Add company header
    doc.fontSize(16).font('Helvetica-Bold').text('Shanthi Pawn Brokers', { align: 'center' });
    doc.moveDown(0.5);
    
    // Add title with date range
    doc.fontSize(12).text(`${tableName}`, { align: 'center' });
    doc.fontSize(10).text(`Period: ${formatDate(fromDate)} to ${formatDate(toDate)}`, { align: 'center' });
    doc.moveDown(1);
    
    // Define table columns and widths
    const columns = [
      { title: 'Date', width: 65 },
      { title: 'Opening Balance', width: 75 },
      { title: 'Pledge Amount', width: 70 },
      { title: 'Release Amount', width: 75 },
      { title: 'Interest Received', width: 90 },
      { title: 'Additional Interest', width: 95 },
      { title: 'Shop\'s Expense', width: 75 },
      { title: 'Total', width: 60 },
      { title: 'Closing Balance', width: 75 }
    ];
    
    // Calculate table width and position
    const pageWidth = doc.page.width - 60; // Total usable width (minus margins)
    let startX = 30; // Start at left margin
    
    // Draw table header
    doc.fontSize(8).font('Helvetica-Bold');
    columns.forEach(column => {
      doc.text(column.title, startX, doc.y, { width: column.width, align: 'center' });
      startX += column.width;
    });
    
    // Draw header line
    const headerLineY = doc.y + 12;
    doc.moveTo(30, headerLineY).lineTo(doc.page.width - 30, headerLineY).stroke();
    doc.moveDown(0.5);
    
    // Initialize tracking variables
    let runningBalance = parseFloat(openingBalance);
    let totalPledge = 0;
    let totalRelease = 0;
    let totalInterest = 0;
    let totalAdditionalInterest = 0;
    let totalExpense = 0;
    
    // Track first opening balance and last closing balance
    const firstOpeningBalance = runningBalance;
    let lastClosingBalance = runningBalance;
    
    // Draw table rows
    doc.font('Helvetica');
    finalRecords.forEach((record, i) => {
      // Get values with defaults
      const pledgeAmount = record['Pledge Amount'] || 0;
      const releaseAmount = record['Release Amount'] || 0;
      const interestReceived = record['Interest Received'] || 0;
      const additionalInterestReceived = record['Additional Interest Received'] || 0;
      const expense = record['Expense'] || 0;
      
      // Calculate total and closing balance
      const total = releaseAmount + interestReceived + additionalInterestReceived - expense - pledgeAmount;
      const closingBalance = runningBalance + total;
      
      // Update totals for summary
      totalPledge += pledgeAmount;
      totalRelease += releaseAmount;
      totalInterest += interestReceived;
      totalAdditionalInterest += additionalInterestReceived;
      totalExpense += expense;
      
      // Format date for display
      const dateObj = new Date(record.Date);
      const formattedDate = formatDate(record.Date);
      
      // Check if we need a new page
      if (doc.y > doc.page.height - 50) {
        doc.addPage();
        doc.fontSize(8).font('Helvetica-Bold');
        
        // Redraw header on new page
        startX = 30;
        columns.forEach(column => {
          doc.text(column.title, startX, doc.y, { width: column.width, align: 'center' });
          startX += column.width;
        });
        
        // Draw header line
        const headerLineY = doc.y + 12;
        doc.moveTo(30, headerLineY).lineTo(doc.page.width - 30, headerLineY).stroke();
        doc.moveDown(0.5);
        doc.font('Helvetica');
      }
      
      // Draw row (alternate row coloring)
      if (i % 2 === 1) {
        doc.rect(30, doc.y, pageWidth, 15).fill('#f5f5f5');
        doc.fillColor('black');
      }
      
      // Write cell values
      startX = 30;
      doc.text(formattedDate, startX, doc.y, { width: columns[0].width, align: 'center' });
      startX += columns[0].width;
      
      doc.text(formatCurrency(runningBalance), startX, doc.y, { width: columns[1].width, align: 'right' });
      startX += columns[1].width;
      
      doc.text(formatCurrency(pledgeAmount), startX, doc.y, { width: columns[2].width, align: 'right' });
      startX += columns[2].width;
      
      doc.text(formatCurrency(releaseAmount), startX, doc.y, { width: columns[3].width, align: 'right' });
      startX += columns[3].width;
      
      doc.text(formatCurrency(interestReceived), startX, doc.y, { width: columns[4].width, align: 'right' });
      startX += columns[4].width;
      
      doc.text(formatCurrency(additionalInterestReceived), startX, doc.y, { width: columns[5].width, align: 'right' });
      startX += columns[5].width;
      
      doc.text(formatCurrency(expense), startX, doc.y, { width: columns[6].width, align: 'right' });
      startX += columns[6].width;
      
      doc.text(formatCurrency(total), startX, doc.y, { width: columns[7].width, align: 'right' });
      startX += columns[7].width;
      
      doc.text(formatCurrency(closingBalance), startX, doc.y, { width: columns[8].width, align: 'right' });
      
      // Move to next row
      doc.moveDown(0.8);
      
      // Update running balance for next row
      runningBalance = closingBalance;
      lastClosingBalance = closingBalance;
    });
    
    // Draw summary row separator
    doc.moveTo(30, doc.y).lineTo(doc.page.width - 30, doc.y).stroke();
    doc.moveDown(0.5);
    
    // Draw summary row
    doc.font('Helvetica-Bold');
    startX = 30;
    
    doc.text('Summary', startX, doc.y, { width: columns[0].width, align: 'center' });
    startX += columns[0].width;
    
    doc.text(formatCurrency(firstOpeningBalance), startX, doc.y, { width: columns[1].width, align: 'right' });
    startX += columns[1].width;
    
    doc.text(formatCurrency(totalPledge), startX, doc.y, { width: columns[2].width, align: 'right' });
    startX += columns[2].width;
    
    doc.text(formatCurrency(totalRelease), startX, doc.y, { width: columns[3].width, align: 'right' });
    startX += columns[3].width;
    
    doc.text(formatCurrency(totalInterest), startX, doc.y, { width: columns[4].width, align: 'right' });
    startX += columns[4].width;
    
    doc.text(formatCurrency(totalAdditionalInterest), startX, doc.y, { width: columns[5].width, align: 'right' });
    startX += columns[5].width;
    
    doc.text(formatCurrency(totalExpense), startX, doc.y, { width: columns[6].width, align: 'right' });
    startX += columns[6].width;
    
    const totalSum = totalRelease + totalInterest + totalAdditionalInterest - totalExpense - totalPledge;
    doc.text(formatCurrency(totalSum), startX, doc.y, { width: columns[7].width, align: 'right' });
    startX += columns[7].width;
    
    doc.text(formatCurrency(lastClosingBalance), startX, doc.y, { width: columns[8].width, align: 'right' });
    
    // Add footer
    doc.fontSize(8).text('© Shanthi Pawn Brokers', 30, doc.page.height - 40, { align: 'center' });
    
    // Finalize PDF
    doc.end();
  })
  .catch(error => {
    console.error('Error:', error);
    res.status(500).send('Database error');
  });
});

// Helper function to format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`;
}

// Helper function to format currency
function formatCurrency(amount) {
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
// GET: Render the Add Bill form
// Add a new endpoint to get the next bill number based on series type
app.get('/get-next-bill-number', (req, res) => {
  const useSeries = req.query.useSeries === 'true';
  
  // Get next bill number based on series type
  getNextBillNumber(useSeries, (nextBillNumber) => {
    res.json({ nextBillNumber });
  });
});

// Function to get the next bill number
function getNextBillNumber(useSeries, callback) {
  let query;
  
  if (useSeries) {
    // Query for S series bill numbers
    query = `
      SELECT "Bill Number" as billNumber FROM (
        SELECT "Bill Number" FROM S_active_pledges
        UNION
        SELECT "Bill Number" FROM S_released_pledges
      ) WHERE "Bill Number" LIKE 'S%' ORDER BY billNumber DESC LIMIT 1
    `;
  } else {
    // Query for standard bill numbers
    query = `
      SELECT "Bill Number" as billNumber FROM (
        SELECT "Bill Number" FROM active_pledges
        UNION
        SELECT "Bill Number" FROM released_pledges
      ) WHERE "Bill Number" NOT LIKE 'S%' ORDER BY billNumber DESC LIMIT 1
    `;
  }
  
  db.get(query, [], (err, result) => {
    let nextBillNumber;
    
    if (useSeries) {
      // Handle S series bill number generation
      nextBillNumber = 'SA0001'; // Default starting value for S series
      
      if (!err && result && result.billNumber) {
        const lastBill = result.billNumber;
        // Remove the 'S' prefix to process the letter and number parts
        const seriesLetter = lastBill.charAt(1);
        const number = parseInt(lastBill.substring(2));
        
        if (!isNaN(number)) {
          if (number < 9999) {
            // Increment the number
            const newNumber = number + 1;
            nextBillNumber = 'S' + seriesLetter + newNumber.toString().padStart(4, '0');
          } else {
            // Move to the next letter
            const nextLetter = String.fromCharCode(seriesLetter.charCodeAt(0) + 1);
            if (nextLetter <= 'Z') {
              nextBillNumber = 'S' + nextLetter + '0001';
            }
          }
        }
      }
    } else {
      // Standard bill number generation
      nextBillNumber = 'A0001'; // Default starting value
      
      if (!err && result && result.billNumber) {
        const lastBill = result.billNumber;
        const letter = lastBill.charAt(0);
        const number = parseInt(lastBill.substring(1));
        
        if (!isNaN(number)) {
          if (number < 9999) {
            // Increment the number
            const newNumber = number + 1;
            nextBillNumber = letter + newNumber.toString().padStart(4, '0');
          } else {
            // Move to the next letter
            const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
            if (nextLetter <= 'Z') {
              nextBillNumber = nextLetter + '0001';
            }
          }
        }
      }
    }
    
    callback(nextBillNumber);
  });
}

// Update the GET route to use the new function
app.get('/add-bill', (req, res) => {
  getNextBillNumber(false, (nextBillNumber) => {
    res.render('addBill', { 
      error: null, 
      success: null,
      nextBillNumber: nextBillNumber 
    });
  });
});

app.post('/add-bill', (req, res) => {
  const {
    billNumber, name, fatherOrSpouseName, date, phoneNumber, address, townOrCity, aadharNumber,
    goldSilver, noOfItems, items, itemsValue, remarks, interestRate, initialPledgedAmount,
    goldGrossWeight, silverGrossWeight, principleAddingHis, repayHistory, useSeries
  } = req.body;
  
  try {
    // Parse the items JSON objects from the form
    const itemsObject = items ? JSON.parse(items) : {};
    const itemsValueObject = itemsValue ? JSON.parse(itemsValue) : {};
    
    // Prepare data for insertion
    // FIX: Fix the logic for gold/silver weight assignment
    const data = [
      billNumber, name, fatherOrSpouseName, date, phoneNumber, address || null, townOrCity, aadharNumber || null,
      goldSilver, noOfItems, JSON.stringify(itemsObject), remarks || null,
      interestRate, initialPledgedAmount, JSON.stringify(itemsValueObject),
      goldSilver === 'Silver' ? null : (goldGrossWeight || null),   // Only null if it's purely Silver
      goldSilver === 'Gold' ? null : (silverGrossWeight || null),   // Only null if it's purely Gold
      principleAddingHis || JSON.stringify({}),
      repayHistory || JSON.stringify({})
    ];
    
    // Determine which tables to use based on the checkbox
    const isSeries = useSeries === 'on';
    const pledgeTableName = isSeries ? 'S_active_pledges' : 'active_pledges';
    const dayBookTableName = isSeries ? 'S_Day_Book' : 'Day_Book';
    const pledgeRecordsTableName = isSeries ? 'S_Pledge_Records' : 'Pledge_Records';
    const insightsTableName = isSeries ? 'S_Insights_gold_silver' : 'Insights_gold_silver';
    const ledgerTableName = isSeries ? 'S_Ledger' : 'Ledger';
    
    // Extract series letter and pledge number from bill number
    // For example: A0001 => series: 'A', pledge_no: 1
    const series = billNumber.match(/[A-Za-z]+/)[0];
    const pledgeNo = parseInt(billNumber.match(/\d+/)[0]);
    
    // Format item descriptions based on gold/silver selection
    let itemDescription = {};
    let itemWeights = {};
    
    // Calculate total value of all items
    let totalValue = 0;
    Object.values(itemsValueObject).forEach(value => {
      totalValue += parseFloat(value);
    });
    
    // Create item descriptions and weights based on gold/silver selection
    if (goldSilver === 'Gold') {
      // All items are gold
      itemDescription = {
        "gold": Object.keys(itemsObject).join(',')
      };
      itemWeights = {
        "gold": parseFloat(goldGrossWeight || 0).toFixed(3)
      };
    } else if (goldSilver === 'Silver') {
      // All items are silver
      itemDescription = {
        "silver": Object.keys(itemsObject).join(',')
      };
      itemWeights = {
        "silver": parseFloat(silverGrossWeight || 0).toFixed(3)
      };
    } else if (goldSilver === 'GoldSilver') {
      // Mixed gold and silver items
      // We need to determine which items are gold and which are silver
      // based on the toggle in the form
      
      const goldItems = [];
      const silverItems = [];
      
      // Parse the items from the form
      for (let i = 1; i <= parseInt(noOfItems); i++) {
        const itemName = req.body[`itemName${i}`];
        const isItemSilver = req.body[`itemType${i}`] === 'on';
        
        if (isItemSilver) {
          silverItems.push(itemName);
        } else {
          goldItems.push(itemName);
        }
      }
      
      itemDescription = {};
      if (goldItems.length > 0) {
        itemDescription.gold = goldItems.join(',');
      }
      if (silverItems.length > 0) {
        itemDescription.silver = silverItems.join(',');
      }
      
      itemWeights = {};
      if (goldGrossWeight && parseFloat(goldGrossWeight) > 0) {
        itemWeights.gold = parseFloat(goldGrossWeight).toFixed(3);
      }
      if (silverGrossWeight && parseFloat(silverGrossWeight) > 0) {
        itemWeights.silver = parseFloat(silverGrossWeight).toFixed(3);
      }
    }
    
    // Ledger data
    const ledgerData = [
      series,                        // series
      pledgeNo,                      // pledge_no
      date,                          // pledge_date
      name,                          // name
      fatherOrSpouseName,            // father_spouse_name
      townOrCity,                    // town_city
      initialPledgedAmount,          // principal_amount
      12,                            // interest (default 12%)
      JSON.stringify(itemDescription), // item_description
      JSON.stringify(itemWeights),   // weights
      totalValue,                    // value
      6,                             // time_agreed (default 6 months)
      null,                          // release_date (null for new bills)
      null,                          // h_from_no (null for new bills)
      initialPledgedAmount,          // principal (same as principal_amount)
      null                           // interest_amount (calculated later)
    ];
    
    // Start a transaction to ensure all operations are atomic
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // 1. Insert into active_pledges or S_active_pledges
      db.run(`
        INSERT INTO ${pledgeTableName} (
          "Bill Number", "Name", "FatherorSpouseName", "Date", "Phone Number", "Address", 
          "townOrCity", "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
          "Remarks", "Interest Rate", "Initial Pledged Amount", 
          "Items_Value", "Gold_Gross_Weight", "Silver_Gross_Weight",
          "Principle_Adding_His", "Repay History"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, data, function(err) {
        if (err) {
          console.error(`Error inserting into ${pledgeTableName}:`, err.message);
          db.run('ROLLBACK');
          return res.render('addBill', { 
            error: 'Error adding bill: ' + err.message, 
            success: null,
            nextBillNumber: billNumber 
          });
        }
        
        // Convert pledge amount to integer
        const pledgeAmount = parseInt(initialPledgedAmount);
        
        // 2. Insert into Ledger or S_Ledger table
        db.run(`
          INSERT INTO ${ledgerTableName} (
            series, pledge_no, pledge_date, name, father_spouse_name, town_city,
            principal_amount, interest, item_description, weights, value,
            time_agreed, release_date, h_from_no, principal, interest_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, ledgerData, function(err) {
          if (err) {
            console.error(`Error inserting into ${ledgerTableName}:`, err.message);
            db.run('ROLLBACK');
            return res.render('addBill', { 
              error: 'Error adding to ledger: ' + err.message, 
              success: null,
              nextBillNumber: billNumber 
            });
          }
          
          // 3. Update Day_Book or S_Day_Book
          db.get(`SELECT * FROM ${dayBookTableName} WHERE "Date" = ?`, [date], (err, dayBookRecord) => {
            if (err) {
              console.error(`Error checking ${dayBookTableName}:`, err.message);
              db.run('ROLLBACK');
              return res.render('addBill', { 
                error: `Error checking ${dayBookTableName}: ${err.message}`, 
                success: null,
                nextBillNumber: billNumber 
              });
            }
            
            if (dayBookRecord) {
              // Update existing record
              const updatedPledgeAmount = dayBookRecord["Pledge Amount"] + pledgeAmount;
              const updatedTotal = dayBookRecord["Release Amount"] + 
                                 dayBookRecord["Interest Received"] + 
                                 dayBookRecord["Additional Interest Received"] - 
                                 updatedPledgeAmount;
              
              db.run(`
                UPDATE ${dayBookTableName} 
                SET "Pledge Amount" = ?, "Total" = ?
                WHERE "Date" = ?
              `, [updatedPledgeAmount, updatedTotal, date], function(err) {
                if (err) {
                  console.error(`Error updating ${dayBookTableName}:`, err.message);
                  db.run('ROLLBACK');
                  return res.render('addBill', { 
                    error: `Error updating ${dayBookTableName}: ${err.message}`, 
                    success: null,
                    nextBillNumber: billNumber 
                  });
                }
                
                processPledgeRecords();
              });
            } else {
              // Create new record with zero values for release and interest
              const total = 0 - pledgeAmount; // -(Pledge Amount)
              
              db.run(`
                INSERT INTO ${dayBookTableName} (
                  "Date", "Pledge Amount", "Release Amount", "Interest Received", 
                  "Additional Interest Received", "Total"
                ) VALUES (?, ?, 0, 0, 0, ?)
              `, [date, pledgeAmount, total], function(err) {
                if (err) {
                  console.error(`Error inserting into ${dayBookTableName}:`, err.message);
                  db.run('ROLLBACK');
                  return res.render('addBill', { 
                    error: `Error inserting into ${dayBookTableName}: ${err.message}`, 
                    success: null,
                    nextBillNumber: billNumber 
                  });
                }
                
                processPledgeRecords();
              });
            }
          });
          
          // 4. Update Pledge_Records or S_Pledge_Records
          function processPledgeRecords() {
            // FIX: Ensure proper calculation of gold and silver weights
            // For standard records, include gold and silver weights
            if (!isSeries) {
              // This is the key fix - ensure weights are calculated correctly
              const goldWeight = goldSilver === 'Silver' ? 0 : (parseFloat(goldGrossWeight) || 0);
              const silverWeight = goldSilver === 'Gold' ? 0 : (parseFloat(silverGrossWeight) || 0);
              
              db.run(`
                INSERT INTO ${pledgeRecordsTableName} (
                  "Date", "Bill No", "Pledge Amount", "Pledged Gold Weight", "Pledged Silver Weight"
                ) VALUES (?, ?, ?, ?, ?)
              `, [date, billNumber, pledgeAmount, goldWeight, silverWeight], function(err) {
                if (err) {
                  console.error(`Error inserting into ${pledgeRecordsTableName}:`, err.message);
                  db.run('ROLLBACK');
                  return res.render('addBill', { 
                    error: `Error inserting into ${pledgeRecordsTableName}: ${err.message}`, 
                    success: null,
                    nextBillNumber: billNumber 
                  });
                }
                
                updateInsights();
              });
            } else {
              // For S series, only include pledge amount
              db.run(`
                INSERT INTO ${pledgeRecordsTableName} (
                  "Date", "Bill No", "Pledge Amount"
                ) VALUES (?, ?, ?)
              `, [date, billNumber, pledgeAmount], function(err) {
                if (err) {
                  console.error(`Error inserting into ${pledgeRecordsTableName}:`, err.message);
                  db.run('ROLLBACK');
                  return res.render('addBill', { 
                    error: `Error inserting into ${pledgeRecordsTableName}: ${err.message}`, 
                    success: null,
                    nextBillNumber: billNumber 
                  });
                }
                updateInsights();
              });
            }
          }
          
          // 5. Update Insights_gold_silver table
          function updateInsights() {
            // Only update insights for standard bills with gold/silver
            if (isSeries) {
              // For S series, update S_Insights_gold_silver table
              const goldWeight = goldSilver === 'Silver' ? 0 : (parseFloat(goldGrossWeight) || 0);
              const silverWeight = goldSilver === 'Gold' ? 0 : (parseFloat(silverGrossWeight) || 0);
              
              // Check if insights record exists for S series
              db.get(`SELECT * FROM ${insightsTableName} LIMIT 1`, [], (err, insightRecord) => {
                if (err) {
                  console.error(`Error checking ${insightsTableName}:`, err.message);
                  db.run('ROLLBACK');
                  return res.render('addBill', { 
                    error: `Error checking ${insightsTableName}: ${err.message}`, 
                    success: null,
                    nextBillNumber: billNumber 
                  });
                }
                
                if (insightRecord) {
                  // Update existing S series record
                  const updatedGold = insightRecord["Gold in Reserve"] + goldWeight;
                  const updatedSilver = insightRecord["Silver in Reserve"] + silverWeight;
                  
                  db.run(`
                    UPDATE ${insightsTableName} 
                    SET "Gold in Reserve" = ?, "Silver in Reserve" = ?
                  `, [updatedGold, updatedSilver], function(err) {
                    if (err) {
                      console.error(`Error updating ${insightsTableName}:`, err.message);
                      db.run('ROLLBACK');
                      return res.render('addBill', { 
                        error: `Error updating ${insightsTableName}: ${err.message}`, 
                        success: null,
                        nextBillNumber: billNumber 
                      });
                    }
                    completeTransaction();
                  });
                } else {
                  // Create new S series record
                  db.run(`
                    INSERT INTO ${insightsTableName} (
                      "Gold in Reserve", "Silver in Reserve"
                    ) VALUES (?, ?)
                  `, [goldWeight, silverWeight], function(err) {
                    if (err) {
                      console.error(`Error inserting into ${insightsTableName}:`, err.message);
                      db.run('ROLLBACK');
                      return res.render('addBill', { 
                        error: `Error inserting into ${insightsTableName}: ${err.message}`, 
                        success: null,
                        nextBillNumber: billNumber 
                      });
                    }
                    completeTransaction();
                  });
                }
              });
              return;
              
            }
            
            // FIX: Ensure proper calculation of gold and silver weights - same logic as in processPledgeRecords
            const goldWeight = goldSilver === 'Silver' ? 0 : (parseFloat(goldGrossWeight) || 0);
            const silverWeight = goldSilver === 'Gold' ? 0 : (parseFloat(silverGrossWeight) || 0);
            
            // Check if insights record exists
            db.get(`SELECT * FROM ${insightsTableName} LIMIT 1`, [], (err, insightRecord) => {
              if (err) {
                console.error(`Error checking ${insightsTableName}:`, err.message);
                db.run('ROLLBACK');
                return res.render('addBill', { 
                  error: `Error checking ${insightsTableName}: ${err.message}`, 
                  success: null,
                  nextBillNumber: billNumber 
                });
              }
              
              if (insightRecord) {
                // Update existing record
                const updatedGold = insightRecord["Gold in Reserve"] + goldWeight;
                const updatedSilver = insightRecord["Silver in Reserve"] + silverWeight;
                
                db.run(`
                  UPDATE ${insightsTableName} 
                  SET "Gold in Reserve" = ?, "Silver in Reserve" = ?
                `, [updatedGold, updatedSilver], function(err) {
                  if (err) {
                    console.error(`Error updating ${insightsTableName}:`, err.message);
                    db.run('ROLLBACK');
                    return res.render('addBill', { 
                      error: `Error updating ${insightsTableName}: ${err.message}`, 
                      success: null,
                      nextBillNumber: billNumber 
                    });
                  }
                  
                  completeTransaction();
                });
              } else {
                // Create new record
                db.run(`
                  INSERT INTO ${insightsTableName} (
                    "Gold in Reserve", "Silver in Reserve"
                  ) VALUES (?, ?)
                `, [goldWeight, silverWeight], function(err) {
                  if (err) {
                    console.error(`Error inserting into ${insightsTableName}:`, err.message);
                    db.run('ROLLBACK');
                    return res.render('addBill', { 
                      error: `Error inserting into ${insightsTableName}: ${err.message}`, 
                      success: null,
                      nextBillNumber: billNumber 
                    });
                  }
                  
                  completeTransaction();
                });
              }
            });
          }
          
          function completeTransaction() {
            // Commit the transaction
            db.run('COMMIT', (err) => {
              if (err) {
                console.error('Error committing transaction:', err.message);
                db.run('ROLLBACK');
                return res.render('addBill', { 
                  error: 'Error committing transaction: ' + err.message, 
                  success: null,
                  nextBillNumber: billNumber 
                });
              }
              
              // Redirect to print-bill page with the bill number and table info
              res.redirect(`/print-bill?billNumber=${billNumber}&tableName=${pledgeTableName}`);
            });
          }
        });
      });
    });
  } catch (error) {
    console.error('Error processing form data:', error.message);
    res.render('addBill', { 
      error: 'Error processing form data: ' + error.message, 
      success: null,
      nextBillNumber: billNumber
    });
  }
});

// Add these routes to your server.js file

// Route to display the edit bill form with search functionality
app.get('/edit-bill', (req, res) => {
  res.render('editBill', { 
    error: null, 
    success: null,
    bill: null,
    searched: false
  });
});

app.post('/fetch-bill', (req, res) => {
  const { billNumber, tableName } = req.body;
  
  // Validate the table name to prevent SQL injection
  const validTableNames = ['active_pledges', 'S_active_pledges'];
  if (!validTableNames.includes(tableName)) {
    return res.render('editBill', {
      error: 'Invalid table selection',
      success: null,
      bill: null,
      searched: true,
      tableName: tableName
    });
  }

  // Query the database for the bill
  db.get(`
    SELECT * FROM ${tableName} 
    WHERE "Bill Number" = ?
  `, [billNumber], (err, bill) => {
    if (err) {
      console.error('Error fetching bill:', err.message);
      return res.render('editBill', {
        error: 'Error fetching bill: ' + err.message,
        success: null,
        bill: null,
        searched: true,
        tableName: tableName
      });
    }
    
    if (!bill) {
      return res.render('editBill', {
        error: 'Bill not found',
        success: null,
        bill: null,
        searched: true,
        tableName: tableName
      });
    }
    
    // Parse JSON fields
    try {
      bill.Items = JSON.parse(bill.Items);
      bill.Items_Value = JSON.parse(bill.Items_Value || '{}');
      bill.Principle_Adding_His = JSON.parse(bill.Principle_Adding_His || '{}');
      bill.Repay_History = JSON.parse(bill['Repay History'] || '{}');
      
      res.render('editBill', {
        error: null,
        success: null,
        bill: bill,
        tableName: tableName,
        searched: true
      });
    } catch (error) {
      console.error('Error parsing JSON data:', error.message);
      res.render('editBill', {
        error: 'Error parsing bill data: ' + error.message,
        success: null,
        bill: null,
        searched: true,
        tableName: tableName
      });
    }
  });
});

app.post('/update-bill', (req, res) => {
  const { 
    tableName, billNumber, name, fatherOrSpouseName, date, phoneNumber, address, townOrCity, 
    aadharNumber, goldSilver, noOfItems, items, itemsValue, remarks, interestRate, initialPledgedAmount,
    goldGrossWeight, silverGrossWeight, principleAddingHis, repayHistory
  } = req.body;
  
  try {
    // Validate the table name to prevent SQL injection
    const validTableNames = ['active_pledges', 'S_active_pledges'];
    if (!validTableNames.includes(tableName)) {
      return res.render('editBill', {
        error: 'Invalid table selection',
        success: null, 
        bill: null,
        searched: false
      });
    }
    
    // Parse JSON fields if they're strings
    const itemsObject = typeof items === 'string' ? JSON.parse(items) : items;
    const itemsValueObject = typeof itemsValue === 'string' ? JSON.parse(itemsValue) : itemsValue;
    const principleAddingHisObject = typeof principleAddingHis === 'string' ? 
                                    JSON.parse(principleAddingHis) : principleAddingHis;
    const repayHistoryObject = typeof repayHistory === 'string' ? 
                              JSON.parse(repayHistory) : repayHistory;
    
    // Update query with gold and silver weights based on selection
    const goldWeightValue = (goldSilver === 'Gold' || goldSilver === 'GoldSilver') ? goldGrossWeight : null;
    const silverWeightValue = (goldSilver === 'Silver' || goldSilver === 'GoldSilver') ? silverGrossWeight : null;

    // Update query
    db.run(`
      UPDATE ${tableName} SET 
        "Name" = ?,
        "FatherorSpouseName" = ?,
        "Date" = ?,
        "Phone Number" = ?,
        "Address" = ?,
        "townOrCity" = ?,
        "Aadhar_Number" = ?,
        "Gold/Silver" = ?,
        "No_of_items" = ?,
        "Items" = ?,
        "Items_Value" = ?,
        "Remarks" = ?,
        "Interest Rate" = ?,
        "Initial Pledged Amount" = ?,
        "Gold_Gross_Weight" = ?,
        "Silver_Gross_Weight" = ?,
        "Principle_Adding_His" = ?,
        "Repay History" = ?
      WHERE "Bill Number" = ?
    `, [
      name, 
      fatherOrSpouseName,
      date, 
      phoneNumber, 
      address || null, 
      townOrCity, 
      aadharNumber || null, 
      goldSilver, 
      noOfItems, 
      JSON.stringify(itemsObject),
      JSON.stringify(itemsValueObject),
      remarks || null, 
      interestRate, 
      initialPledgedAmount,
      goldWeightValue,
      silverWeightValue,
      JSON.stringify(principleAddingHisObject), 
      JSON.stringify(repayHistoryObject),
      billNumber
    ], (err) => {
      if (err) {
        console.error('Error updating bill:', err.message);
        return res.render('editBill', {
          error: 'Error updating bill: ' + err.message,
          success: null,
          bill: null,
          searched: false
        });
      }
      
      // Redirect back to edit page with success query parameter
      res.redirect(`/edit-bill?success=${billNumber}`);
    });
    
  } catch (error) {
    console.error('Error processing form data:', error.message);
    res.render('editBill', {
      error: 'Error processing form data: ' + error.message,
      success: null,
      bill: null,
      searched: false
    });
  }
});
// GET: Principal Addition page
// GET route for principal-addition page
app.get('/principal-addition', (req, res) => {
  const billNumber = req.query.billNumber;
  
  // If no bill number provided, just render the search form
  if (!billNumber) {
    return res.render('principalAddition', { 
      bill: null, 
      error: null, 
      searchBillNumber: '' 
    });
  }

  // If bill number is provided, query the database - now including silver tables
  // Using LIKE with % to handle potential prefix/suffix inconsistencies
  const query = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status"
    FROM active_pledges 
    WHERE "Bill Number" LIKE ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", "Released Date", "Released Remarks", 'Released' as "Status"
    FROM released_pledges 
    WHERE "Bill Number" LIKE ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status"
    FROM S_active_pledges 
    WHERE "Bill Number" LIKE ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", "Released Date", "Released Remarks", 'Released' as "Status"
    FROM S_released_pledges 
    WHERE "Bill Number" LIKE ?
  `;
  
  // Search with flexibility for bill number format
  const searchPattern = `%${billNumber}%`;
  
  db.get(query, [searchPattern, searchPattern, searchPattern, searchPattern], (err, bill) => {
    if (err) {
      console.error("Database error:", err);
      return res.render('principalAddition', { 
        bill: null, 
        error: 'Error fetching bill: ' + err.message,
        searchBillNumber: billNumber 
      });
    } 
    
    if (!bill) {
      console.log(`Bill not found: ${billNumber}`);
      return res.render('principalAddition', { 
        bill: null, 
        error: 'Bill not found',
        searchBillNumber: billNumber 
      });
    } 
    
    // Successfully found the bill
    // console.log(`Found bill: ${bill["Bill Number"]}`);
    res.render('principalAddition', { 
      bill, 
      error: null,
      searchBillNumber: billNumber 
    });
  });
});

// POST route to handle principal amount addition
app.post('/add-principal', express.json(), (req, res) => {
  const { billNumber, date, amount } = req.body;
  
  if (!billNumber || !date || !amount) {
    return res.json({ success: false, error: 'Missing required fields' });
  }
  
  // First, get the current bill details - now including silver tables
  const query = `
    SELECT "Bill Number", "Principle_Adding_His", "Gold/Silver" as "Type", 'active_pledges' as "Table", 'Active' as "Status"
    FROM active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Principle_Adding_His", "Gold/Silver" as "Type", 'released_pledges' as "Table", 'Released' as "Status"
    FROM released_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Principle_Adding_His", "Gold/Silver" as "Type", 'S_active_pledges' as "Table", 'Active' as "Status"
    FROM S_active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Principle_Adding_His", "Gold/Silver" as "Type", 'S_released_pledges' as "Table", 'Released' as "Status"
    FROM S_released_pledges 
    WHERE "Bill Number" = ?
  `;
  
  db.get(query, [billNumber, billNumber, billNumber, billNumber], (err, bill) => {
    if (err) {
      console.error("Database error during principal addition:", err);
      return res.json({ success: false, error: 'Database error: ' + err.message });
    }
    
    if (!bill) {
      // console.log(`Bill not found for principal addition: ${billNumber}`);
      return res.json({ success: false, error: 'Bill not found' });
    }
    
    // If the bill is released, don't allow principal additions
    if (bill.Status === 'Released') {
      return res.json({ success: false, error: 'Cannot add principal to a released bill' });
    }
    
    // Parse existing principal history or create new object if none exists
    let principalHistory = {};
    if (bill.Principle_Adding_His && bill.Principle_Adding_His !== 'null') {
      try {
        principalHistory = JSON.parse(bill.Principle_Adding_His);
      } catch(e) {
        // If invalid JSON, start with empty object
        console.error("Error parsing principal history:", e);
        principalHistory = {};
      }
    }
    
    // Add new principal amount
    principalHistory[date] = parseInt(amount, 10);
    
    // Convert back to JSON string
    const updatedPrincipalHistory = JSON.stringify(principalHistory);
    
    // Determine which table to update based on the Table field
    const tableToUpdate = bill.Table;
    
    console.log(`Updating principal for bill ${billNumber} in table ${tableToUpdate}`);
    
    // Update the database in the appropriate table
    db.run(
      `UPDATE ${tableToUpdate} SET "Principle_Adding_His" = ? WHERE "Bill Number" = ?`,
      [updatedPrincipalHistory, billNumber],
      function(updateErr) {
        if (updateErr) {
          console.error("Error updating principal:", updateErr);
          return res.json({ success: false, error: 'Update error: ' + updateErr.message });
        }
        
        if (this.changes === 0) {
          console.log("No records updated for principal addition");
          return res.json({ success: false, error: 'No records updated' });
        }
        
        console.log(`Successfully added principal for bill ${billNumber}`);
        return res.json({ success: true });
      }
    );
  });
});

// GET route for repayment page
app.get('/repayment', (req, res) => {
  const billNumber = req.query.billNumber;
  
  // If no bill number provided, just render the search form
  if (!billNumber) {
    return res.render('repayment', { 
      bill: null, 
      error: null, 
      searchBillNumber: '' 
    });
  }

  // If bill number is provided, query the database - now including silver tables
  // Using LIKE with % to handle potential prefix/suffix inconsistencies
  const query = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status"
    FROM active_pledges 
    WHERE "Bill Number" LIKE ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", "Released Date", "Released Remarks", 'Released' as "Status"
    FROM released_pledges 
    WHERE "Bill Number" LIKE ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status"
    FROM S_active_pledges 
    WHERE "Bill Number" LIKE ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", "Released Date", "Released Remarks", 'Released' as "Status"
    FROM S_released_pledges 
    WHERE "Bill Number" LIKE ?
  `;
  
  // Search with flexibility for bill number format
  const searchPattern = `%${billNumber}%`;
  
  db.get(query, [searchPattern, searchPattern, searchPattern, searchPattern], (err, bill) => {
    if (err) {
      console.error("Database error:", err);
      return res.render('repayment', { 
        bill: null, 
        error: 'Error fetching bill: ' + err.message,
        searchBillNumber: billNumber 
      });
    } 
    
    if (!bill) {
      console.log(`Bill not found: ${billNumber}`);
      return res.render('repayment', { 
        bill: null, 
        error: 'Bill not found',
        searchBillNumber: billNumber 
      });
    } 
    
    // Successfully found the bill
    // console.log(`Found bill for repayment: ${bill["Bill Number"]}`);
    res.render('repayment', { 
      bill, 
      error: null,
      searchBillNumber: billNumber 
    });
  });
});

// POST route to handle repayment addition
app.post('/add-repayment', express.json(), (req, res) => {
  const { billNumber, date, amount } = req.body;
  
  if (!billNumber || !date || !amount) {
    return res.json({ success: false, error: 'Missing required fields' });
  }
  
  // First, get the current bill details - now including silver tables
  const query = `
    SELECT "Bill Number", "Repay History", "Gold/Silver" as "Type", 'active_pledges' as "Table", 'Active' as "Status"
    FROM active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Repay History", "Gold/Silver" as "Type", 'released_pledges' as "Table", 'Released' as "Status"
    FROM released_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Repay History", "Gold/Silver" as "Type", 'S_active_pledges' as "Table", 'Active' as "Status"
    FROM S_active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Repay History", "Gold/Silver" as "Type", 'S_released_pledges' as "Table", 'Released' as "Status"
    FROM S_released_pledges 
    WHERE "Bill Number" = ?
  `;
  
  db.get(query, [billNumber, billNumber, billNumber, billNumber], (err, bill) => {
    if (err) {
      console.error("Database error during repayment:", err);
      return res.json({ success: false, error: 'Database error: ' + err.message });
    }
    
    if (!bill) {
      // console.log(`Bill not found for repayment: ${billNumber}`);
      return res.json({ success: false, error: 'Bill not found' });
    }
    
    // If the bill is released, don't allow repayments
    if (bill.Status === 'Released') {
      return res.json({ success: false, error: 'Cannot add repayment to a released bill' });
    }
    
    // Parse existing repayment history or create new object if none exists
    let repaymentHistory = {};
    if (bill["Repay History"] && bill["Repay History"] !== 'null') {
      try {
        repaymentHistory = JSON.parse(bill["Repay History"]);
      } catch(e) {
        // If invalid JSON, start with empty object
        console.error("Error parsing repayment history:", e);
        repaymentHistory = {};
      }
    }
    
    // Add new repayment amount
    repaymentHistory[date] = parseInt(amount, 10);
    
    // Convert back to JSON string
    const updatedRepaymentHistory = JSON.stringify(repaymentHistory);
    
    // Determine which table to update based on the Table field
    const tableToUpdate = bill.Table;
    
    console.log(`Updating repayment for bill ${billNumber} in table ${tableToUpdate}`);
    
    // Update the database in the appropriate table
    db.run(
      `UPDATE ${tableToUpdate} SET "Repay History" = ? WHERE "Bill Number" = ?`,
      [updatedRepaymentHistory, billNumber],
      function(updateErr) {
        if (updateErr) {
          console.error("Error updating repayment:", updateErr);
          return res.json({ success: false, error: 'Update error: ' + updateErr.message });
        }
        
        if (this.changes === 0) {
          console.log("No records updated for repayment");
          return res.json({ success: false, error: 'No records updated' });
        }
        
        console.log(`Successfully added repayment for bill ${billNumber}`);
        return res.json({ success: true });
      }
    );
  });
});

// GET: Release page

app.get('/print-bill', (req, res) => {
  const billNumber = req.query.billNumber;

  if (!billNumber) {
    return res.render('printBill', {
      bill: null,
      error: null,
      searchBillNumber: ''
    });
  }

  const query = `
    SELECT "Bill Number", "Name", "FatherorSpouseName", "Date", "Phone Number", "Address",
           "townOrCity", "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", "Items_Value",
           "Remarks", "Interest Rate", "Initial Pledged Amount",
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status"
    FROM active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Name", "FatherorSpouseName", "Date", "Phone Number", "Address",
           "townOrCity", "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", "Items_Value",
           "Remarks", "Interest Rate", "Initial Pledged Amount",
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'S_Active' as "Status"
    FROM S_active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Name", "FatherorSpouseName", "Date", "Phone Number", "Address",
           "townOrCity", "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", "Items_Value",
           "Remarks", "Interest Rate", "Initial Pledged Amount",
           "Principle_Adding_His", "Repay History", "Released Date", "Released Remarks", 'Released' as "Status"
    FROM released_pledges 
    WHERE "Bill Number" = ?
  `;

  db.get(query, [billNumber, billNumber, billNumber], (err, bill) => {
    if (err) {
      return res.render('printBill', {
        bill: null,
        error: 'Error fetching bill: ' + err.message,
        searchBillNumber: billNumber
      });
    }

    if (!bill) {
      return res.render('printBill', {
        bill: null,
        error: 'Bill not found',
        searchBillNumber: billNumber
      });
    }

    res.render('printBill', {
      bill,
      error: null,
      searchBillNumber: billNumber
    });
  });
});


// GET: Render the Find Bill page
// Display the Find Bill page
app.get('/find-bill', (req, res) => {
  res.render('findBill', { results: [], error: null });
});

// POST: Handle the Find Bill search
app.post('/find-bill', (req, res) => {
  const { 
    searchBy, 
    searchValue, 
    startDate, 
    endDate,
    useAdditionalFilter,
    additionalSearchBy,
    additionalSearchValue,
    additionalStartDate,
    additionalEndDate
  } = req.body;

  // Base query parts for gold
  const activeBaseSelect = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number" as "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His" as "Principle_Adding_His", "Repay History" as "Repay History", 
           NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status"
    FROM active_pledges
  `;
  
  const releasedBaseSelect = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number" as "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His" as "Principle_Adding_His", "Repay History" as "Repay History", 
           "Released Date", "Released Remarks", 'Released' as "Status"
    FROM released_pledges
  `;

  // Base query parts for silver
  const SActiveBaseSelect = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number" as "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His" as "Principle_Adding_His", "Repay History" as "Repay History", 
           NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status"
    FROM S_active_pledges
  `;
  
  const SReleasedBaseSelect = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number" as "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His" as "Principle_Adding_His", "Repay History" as "Repay History", 
           "Released Date", "Released Remarks", 'Released' as "Status"
    FROM S_released_pledges
  `;

  let activeWhereClause = '';
  let releasedWhereClause = '';
  let params = [];

  // Handle primary search criteria
  if (searchBy === 'mobile') {
    activeWhereClause = `WHERE "Phone Number" = ?`;
    releasedWhereClause = `WHERE "Phone Number" = ?`;
    params.push(searchValue, searchValue, searchValue, searchValue);
  } 
  else if (searchBy === 'aadhar') {
    activeWhereClause = `WHERE "Aadhar_Number" = ?`;
    releasedWhereClause = `WHERE "Aadhar_Number" = ?`;
    params.push(searchValue, searchValue, searchValue, searchValue);
  } 
  else if (searchBy === 'bill') {
    activeWhereClause = `WHERE "Bill Number" = ?`;
    releasedWhereClause = `WHERE "Bill Number" = ?`;
    params.push(searchValue, searchValue, searchValue, searchValue);
  }
  else if (searchBy === 'name') {
    activeWhereClause = `WHERE "Name" LIKE ?`;
    releasedWhereClause = `WHERE "Name" LIKE ?`;
    params.push(`%${searchValue}%`, `%${searchValue}%`, `%${searchValue}%`, `%${searchValue}%`);
  }
  else if (searchBy === 'place') {
    activeWhereClause = `WHERE "Address" LIKE ?`;
    releasedWhereClause = `WHERE "Address" LIKE ?`;
    params.push(`%${searchValue}%`, `%${searchValue}%`, `%${searchValue}%`, `%${searchValue}%`);
  }
  else if (searchBy === 'date') {
    if (!startDate || !endDate) {
      return res.render('findBill', { results: [], error: 'Both start and end dates are required for date range search' });
    }
    activeWhereClause = `WHERE "Date" BETWEEN ? AND ?`;
    releasedWhereClause = `WHERE "Date" BETWEEN ? AND ?`;
    params.push(startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate);
  } else {
    return res.render('findBill', { results: [], error: 'Invalid search criteria' });
  }

  // Handle additional filter if enabled
  if (useAdditionalFilter === 'on') {
    if (additionalSearchBy === 'mobile') {
      activeWhereClause += ` AND "Phone Number" = ?`;
      releasedWhereClause += ` AND "Phone Number" = ?`;
      params.push(additionalSearchValue, additionalSearchValue, additionalSearchValue, additionalSearchValue);
    } 
    else if (additionalSearchBy === 'aadhar') {
      activeWhereClause += ` AND "Aadhar_Number" = ?`;
      releasedWhereClause += ` AND "Aadhar_Number" = ?`;
      params.push(additionalSearchValue, additionalSearchValue, additionalSearchValue, additionalSearchValue);
    }
    else if (additionalSearchBy === 'name') {
      activeWhereClause += ` AND "Name" LIKE ?`;
      releasedWhereClause += ` AND "Name" LIKE ?`;
      params.push(`%${additionalSearchValue}%`, `%${additionalSearchValue}%`, `%${additionalSearchValue}%`, `%${additionalSearchValue}%`);
    }
    else if (additionalSearchBy === 'place') {
      activeWhereClause += ` AND "Address" LIKE ?`;
      releasedWhereClause += ` AND "Address" LIKE ?`;
      params.push(`%${additionalSearchValue}%`, `%${additionalSearchValue}%`, `%${additionalSearchValue}%`, `%${additionalSearchValue}%`);
    }
    else if (additionalSearchBy === 'date') {
      if (!additionalStartDate || !additionalEndDate) {
        return res.render('findBill', { results: [], error: 'Both start and end dates are required for additional date range filter' });
      }
      activeWhereClause += ` AND "Date" BETWEEN ? AND ?`;
      releasedWhereClause += ` AND "Date" BETWEEN ? AND ?`;
      params.push(additionalStartDate, additionalEndDate, additionalStartDate, additionalEndDate, additionalStartDate, additionalEndDate, additionalStartDate, additionalEndDate);
    }
  }

  // Construct the final query
  const query = `
    ${activeBaseSelect}
    ${activeWhereClause}
    UNION
    ${releasedBaseSelect}
    ${releasedWhereClause}
    UNION
    ${SActiveBaseSelect}
    ${activeWhereClause}
    UNION
    ${SReleasedBaseSelect}
    ${releasedWhereClause}
  `;

  // Execute the query
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error querying database:', err.message);
      res.render('findBill', { results: [], error: 'Error searching for bill: ' + err.message });
    } else if (rows.length === 0) {
      res.render('findBill', { results: [], error: 'No bills found' });
    } else {
      res.render('findBill', { results: rows, error: null });
    }
  });
});

// GET: Render the Insights page
app.get('/insights', (req, res) => {
  // Get the series type from query parameters or default to standard
  const seriesType = req.query.seriesType === 'S' ? 'S' : 'standard';
  
  // First, get the reserve data (gold and silver in reserve)
  const reserveQuery = seriesType === 'S' 
    ? `SELECT * FROM S_Insights_gold_silver`
    : `SELECT * FROM Insights_gold_silver`;
  
  db.get(reserveQuery, [], (err, reserveData) => {
    if (err) {
      console.error('Error fetching reserve data:', err.message);
      return res.render('insights', { bills: [], reserveData: {}, error: 'Error fetching reserve data' });
    }
    
    // Initially just render the page with reserve data but no bills
    res.render('insights', { 
      bills: [], 
      reserveData: reserveData || {}, 
      seriesType: seriesType,
      filters: {},
      error: null 
    });
  });
});

// POST: Handle filtering and querying bills
app.post('/insights', (req, res) => {
  // Get filter parameters from the request body
  const { 
    seriesType,
    ageFilter, 
    customStartDate, 
    customEndDate,
    repaymentStatus
  } = req.body;
  
  // Store filters for re-rendering the form
  const filters = {
    ageFilter,
    customStartDate,
    customEndDate,
    repaymentStatus
  };
  
  // First, get the reserve data
  const reserveQuery = seriesType === 'S' 
    ? `SELECT * FROM S_Insights_gold_silver`
    : `SELECT * FROM Insights_gold_silver`;
  
  db.get(reserveQuery, [], (err, reserveData) => {
    if (err) {
      console.error('Error fetching reserve data:', err.message);
      return res.render('insights', { 
        bills: [], 
        reserveData: {}, 
        seriesType,
        filters,
        error: 'Error fetching reserve data' 
      });
    }
    
    // Determine which tables to query based on seriesType
    const activePledgesTable = seriesType === 'S' ? 'S_active_pledges' : 'active_pledges';
    
    // Build the query based on filters
    let query = `
      SELECT "Bill Number", "Name", "Date", "Phone Number", "Gold/Silver", "No_of_items", "Items", 
             "Initial Pledged Amount", "Principle_Adding_His", "Repay History"
      FROM ${activePledgesTable}
    `;
    
    let whereConditions = [];
    let params = [];
    
    // Apply age filter
    if (ageFilter) {
      const today = new Date();
      let filterDate = new Date();
      
      if (ageFilter === 'custom' && customStartDate && customEndDate) {
        // For custom date range, we'll filter bills between these dates
        whereConditions.push(`"Date" BETWEEN ? AND ?`);
        params.push(customStartDate, customEndDate);
      } else {
        // For predefined age filters
        switch(ageFilter) {
          case '3years':
            filterDate.setFullYear(today.getFullYear() - 3);
            break;
          case '2years':
            filterDate.setFullYear(today.getFullYear() - 2);
            break;
          case '1year':
            filterDate.setFullYear(today.getFullYear() - 1);
            break;
          case '6months':
            filterDate.setMonth(today.getMonth() - 6);
            break;
        }
        
        if (ageFilter !== 'custom') {
          // Format date as YYYY-MM-DD
          const formattedDate = filterDate.toISOString().split('T')[0];
          whereConditions.push(`"Date" <= ?`);
          params.push(formattedDate);
        }
      }
    }
    
    // Apply repayment status filter
    if (repaymentStatus) {
      switch(repaymentStatus) {
        case 'noRepayment':
          whereConditions.push(`("Repay History" IS NULL OR json_object_length("Repay History") = 0)`);
          break;
        case 'hasRepayment':
          whereConditions.push(`"Repay History" IS NOT NULL AND json_object_length("Repay History") > 0`);
          break;
        case 'noPrincipal':
          whereConditions.push(`("Principle_Adding_His" IS NULL OR json_object_length("Principle_Adding_His") = 0)`);
          break;
        case 'hasPrincipal':
          whereConditions.push(`"Principle_Adding_His" IS NOT NULL AND json_object_length("Principle_Adding_His") > 0`);
          break;
      }
    }
    
    // Add WHERE clause if conditions exist
    if (whereConditions.length > 0) {
      query += ' WHERE ' + whereConditions.join(' AND ');
    }
    
    // Order by date (oldest first to match the age filtering)
    query += ' ORDER BY "Date" ASC';
    
    // Execute the query
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Error querying bills:', err.message);
        return res.render('insights', { 
          bills: [], 
          reserveData: reserveData || {}, 
          seriesType,
          filters,
          error: 'Error fetching bills: ' + err.message 
        });
      }
      
      // Calculate age for each bill
      const bills = rows.map(bill => {
        // Parse bill date
        const billDate = new Date(bill.Date);
        const today = new Date();
        
        // Calculate difference in years and months
        let years = today.getFullYear() - billDate.getFullYear();
        let months = today.getMonth() - billDate.getMonth();
        
        // Adjust if months negative
        if (months < 0) {
          years--;
          months += 12;
        }
        
        // Parse JSON fields if they exist
        try {
          if (bill.Items && typeof bill.Items === 'string') {
            bill.Items = JSON.parse(bill.Items);
          }
          if (bill.Principle_Adding_His && typeof bill.Principle_Adding_His === 'string') {
            bill.Principle_Adding_His = JSON.parse(bill.Principle_Adding_His);
          }
          if (bill["Repay History"] && typeof bill["Repay History"] === 'string') {
            bill["Repay History"] = JSON.parse(bill["Repay History"]);
          }
        } catch (e) {
          console.error('Error parsing JSON data:', e.message);
        }
        
        // Add age to bill object
        return {
          ...bill,
          age: {
            years,
            months
          }
        };
      });
      
      // Render the page with filtered data
      res.render('insights', { 
        bills, 
        reserveData: reserveData || {}, 
        seriesType,
        filters,
        error: null 
      });
    });
  });
});

// Route to view all active pledges (for testing)
app.get('/view-active-pledges', (req, res) => {
  db.all('SELECT * FROM active_pledges', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-released-pledges', (req, res) => {
  db.all('SELECT * FROM released_pledges', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-s-active-pledges', (req, res) => {
  db.all('SELECT * FROM S_active_pledges', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-ledger', (req, res) => {
  db.all('SELECT * FROM Ledger', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-s-released-pledges', (req, res) => {
  db.all('SELECT * FROM S_released_pledges', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-s-ledger', (req, res) => {
  db.all('SELECT * FROM S_Ledger', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-expenses', (req, res) => {
  db.all('SELECT * FROM Expenses', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-s-expenses', (req, res) => {
  db.all('SELECT * FROM Expenses', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-daybook', (req, res) => {
  db.all('SELECT * FROM Day_Book', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-s-daybook', (req, res) => {
  db.all('SELECT * FROM S_Day_Book', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-pledgerecord', (req, res) => {
  db.all('SELECT * FROM Pledge_Records', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-s-pledgerecord', (req, res) => {
  db.all('SELECT * FROM S_Pledge_Records', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-insights', (req, res) => {
  db.all('SELECT * FROM Insights_gold_silver', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-s-insights', (req, res) => {
  db.all('SELECT * FROM S_Insights_gold_silver', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-releaserecords', (req, res) => {
  db.all('SELECT * FROM Release_Records', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
app.get('/view-s-releaserecord', (req, res) => {
  db.all('SELECT * FROM S_Release_Records', (err, rows) => {
    if (err) {
      res.send('Error querying database: ' + err.message);
    } else {
      res.json(rows);
    }
  });
});
// GET route to display the release page
app.get('/release', (req, res) => {
  const billNumber = req.query.billNumber;
  
  // If no bill number provided, just render the search form
  if (!billNumber) {
    return res.render('release', { 
      bill: null, 
      error: null, 
      searchBillNumber: '' 
    });
  }

  // If bill number is provided, query all four tables
  const query = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status", 'Regular' as "Type"
    FROM active_pledges 
    WHERE "Bill Number" = ?
    
    UNION
    
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", "Released Date", "Released Remarks", 'Released' as "Status", 'Regular' as "Type"
    FROM released_pledges 
    WHERE "Bill Number" = ?
    
    UNION
    
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status", 'Special' as "Type"
    FROM S_active_pledges 
    WHERE "Bill Number" = ?
    
    UNION
    
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", "Released Date", "Released Remarks", 'Released' as "Status", 'Special' as "Type"
    FROM S_released_pledges 
    WHERE "Bill Number" = ?
  `;
  
  db.get(query, [billNumber, billNumber, billNumber, billNumber], (err, bill) => {
    if (err) {
      return res.render('release', { 
        bill: null, 
        error: 'Error fetching bill: ' + err.message,
        searchBillNumber: billNumber 
      });
    } 
    
    if (!bill) {
      return res.render('release', { 
        bill: null, 
        error: 'Bill not found',
        searchBillNumber: billNumber 
      });
    } 
    
    // Successfully found the bill
    res.render('release', { 
      bill, 
      error: null,
      searchBillNumber: billNumber 
    });
  });
});

app.post('/release-bill', (req, res) => {
  const { billNumber, remarks } = req.body;
  console.log("Release request received:", { billNumber, remarks });
  
  if (!billNumber || !remarks) {
    console.log("Missing required fields:", { billNumber, remarks });
    if (req.xhr) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    return res.redirect('/release?billNumber=' + billNumber + '&error=Missing required fields');
  }
  
  // Start a transaction to ensure data consistency
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // First check active_pledges
    db.get('SELECT *, "Regular" as "Type" FROM active_pledges WHERE "Bill Number" = ?', [billNumber], (err, bill) => {
      if (err) {
        console.error("Error querying active_pledges:", err);
        db.run('ROLLBACK');
        return handleErrorResponse(res, billNumber, 'Database error: ' + err.message);
      }
      
      // If not found in active_pledges, check S_active_pledges
      if (!bill) {
        db.get('SELECT *, "Special" as "Type" FROM S_active_pledges WHERE "Bill Number" = ?', [billNumber], (err, specialBill) => {
          if (err) {
            console.error("Error querying S_active_pledges:", err);
            db.run('ROLLBACK');
            return handleErrorResponse(res, billNumber, 'Database error: ' + err.message);
          }
          
          if (!specialBill) {
            console.log("Bill not found in either active table:", billNumber);
            db.run('ROLLBACK');
            return handleErrorResponse(res, billNumber, 'Bill not found or already released');
          }
          
          // Process the special bill
          processRelease(specialBill, remarks, true, res);
        });
      } else {
        // Process the regular bill
        processRelease(bill, remarks, false, res);
      }
    });
  });
  
  // Helper function to handle error responses
  function handleErrorResponse(res, billNumber, errorMessage) {
    if (req.xhr) {
      return res.status(400).json({ error: errorMessage });
    }
    return res.redirect('/release?billNumber=' + billNumber + '&error=' + encodeURIComponent(errorMessage));
  }
  
  // Helper function to process the release
  function processRelease(bill, remarks, isSpecial, res) {
    console.log(`Processing ${isSpecial ? 'special' : 'regular'} bill release:`, bill["Bill Number"]);
    
    // Current date for the released_date field
    const now = new Date();
    const istOptions = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const istDateParts = new Intl.DateTimeFormat('en-IN', istOptions).format(now).split('/');
    const releasedDate = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;    
    
    // Calculate Interest_Received and additional_Interest_received
    const { interestReceived, additionalInterestReceived } = calculateInterest(bill["Date"], bill["Initial Pledged Amount"]);
    
    // Extract series and pledge_no from Bill Number
    const series = bill["Bill Number"].match(/^[A-Za-z]+/)[0];
    const pledgeNo = parseInt(bill["Bill Number"].replace(series, ''), 10);
    
    console.log(`Extracted from bill number: series=${series}, pledgeNo=${pledgeNo}`);
    
    // Determine which tables to use based on isSpecial flag
    const activeTable = isSpecial ? 'S_active_pledges' : 'active_pledges';
    const releasedTable = isSpecial ? 'S_released_pledges' : 'released_pledges';
    const ledgerTable = isSpecial ? 'S_Ledger' : 'Ledger';
    
    // Update Ledger table
    updateLedger(ledgerTable, series, pledgeNo, releasedDate, interestReceived, remarks, (ledgerErr) => {
      if (ledgerErr) {
        console.error(`Error updating ${ledgerTable}:`, ledgerErr);
        db.run('ROLLBACK');
        return handleErrorResponse(res, bill["Bill Number"], `Error updating ${ledgerTable}: ${ledgerErr.message}`);
      }
      
      console.log(`Successfully updated ${ledgerTable}`);
      
      // Get existing columns from the table to ensure we're inserting correctly
      db.all(`PRAGMA table_info(${releasedTable})`, [], (err, columns) => {
        if (err) {
          console.error(`Error getting column info for ${releasedTable}:`, err);
          db.run('ROLLBACK');
          return handleErrorResponse(res, bill["Bill Number"], `Error getting table structure: ${err.message}`);
        }
        
        console.log(`Columns in ${releasedTable}:`, columns.map(col => col.name));
        
        // Extract or default fields that might not be in older records
        const fatherOrSpouseName = bill["FatherorSpouseName"] || '';
        const townOrCity = bill["townOrCity"] || '';
        const itemsValue = bill["Items_Value"] || '';
        const silverGrossWeight = bill["Silver_Gross_Weight"] || '';
        const goldGrossWeight = bill["Gold_Gross_Weight"] || '';
        
        // Construct dynamic query based on actual table columns
        const columnNames = columns.map(col => `"${col.name}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        
        const insertQuery = `INSERT INTO ${releasedTable} (${columnNames}) VALUES (${placeholders})`;
        
        // Prepare values for all possible columns (use null for those not present in bill)
        const values = columns.map(col => {
          const colName = col.name;
          
          // Special handling for certain columns
          if (colName === "Released Date") return releasedDate;
          if (colName === "Released Remarks") return remarks;
          if (colName === "Interest_Received") return interestReceived;
          if (colName === "Additional_Interest") return additionalInterestReceived;
          
          // Map from bill object with some common field name variations
          return bill[colName] || 
                 (colName === "FatherorSpouseName" ? fatherOrSpouseName : null) ||
                 (colName === "townOrCity" ? townOrCity : null) ||
                 (colName === "Items_Value" ? itemsValue : null) ||
                 (colName === "Silver_Gross_Weight" ? silverGrossWeight : null) ||
                 (colName === "Gold_Gross_Weight" ? goldGrossWeight : null) ||
                 null;
        });
        
        console.log(`Executing insert into ${releasedTable}`);
        
        // Execute the insert with all values
        db.run(insertQuery, values, function(insertErr) {
          if (insertErr) {
            console.error(`Error inserting into ${releasedTable}:`, insertErr);
            db.run('ROLLBACK');
            return handleErrorResponse(res, bill["Bill Number"], `Error inserting into ${releasedTable}: ${insertErr.message}`);
          }
          
          console.log(`Successfully inserted into ${releasedTable}`);
          
          // Delete from active_pledges or S_active_pledges
          db.run(`DELETE FROM ${activeTable} WHERE "Bill Number" = ?`, [bill["Bill Number"]], function(deleteErr) {
            if (deleteErr) {
              console.error(`Error deleting from ${activeTable}:`, deleteErr);
              db.run('ROLLBACK');
              return handleErrorResponse(res, bill["Bill Number"], `Error deleting from ${activeTable}: ${deleteErr.message}`);
            }
            
            console.log(`Successfully deleted from ${activeTable}`);
            
            // Update Day Book
            updateDayBook(releasedDate, 0, parseFloat(bill["Initial Pledged Amount"]) || 0, 
                          interestReceived, additionalInterestReceived, isSpecial, 
                          (dayBookErr) => {
              if (dayBookErr) {
                console.error("Error updating Day Book:", dayBookErr);
                db.run('ROLLBACK');
                return handleErrorResponse(res, bill["Bill Number"], `Error updating Day Book: ${dayBookErr.message}`);
              }
              
              // Update Release Records
              updateReleaseRecords(releasedDate, bill["Bill Number"], 
                                   parseFloat(bill["Initial Pledged Amount"]) || 0,
                                   interestReceived, additionalInterestReceived, 
                                   goldGrossWeight, silverGrossWeight, isSpecial,
                                   (releaseRecordsErr) => {
                if (releaseRecordsErr) {
                  console.error("Error updating Release Records:", releaseRecordsErr);
                  db.run('ROLLBACK');
                  return handleErrorResponse(res, bill["Bill Number"], `Error updating Release Records: ${releaseRecordsErr.message}`);
                }
                
                // Update Insights
                updateInsights(goldGrossWeight, silverGrossWeight, isSpecial,
                              (insightsErr) => {
                  if (insightsErr) {
                    console.error("Error updating Insights:", insightsErr);
                    db.run('ROLLBACK');
                    return handleErrorResponse(res, bill["Bill Number"], `Error updating Insights: ${insightsErr.message}`);
                  }
                  
                  // Commit the transaction if everything was successful
                  db.run('COMMIT', function(commitErr) {
                    if (commitErr) {
                      console.error("Error committing transaction:", commitErr);
                      db.run('ROLLBACK');
                      return handleErrorResponse(res, bill["Bill Number"], `Error committing transaction: ${commitErr.message}`);
                    }
                    
                    console.log("Transaction committed successfully");
                    
                    // Send successful response
                    if (req.xhr) {
                      return res.json({ success: true, message: 'Bill successfully released' });
                    }
                    return res.redirect('/release?billNumber=' + bill["Bill Number"] + '&success=Bill successfully released');
                  });
                });
              });
            });
          });
        });
      });
    });
  }
  
  // Helper function to update Ledger (with callback)
  function updateLedger(ledgerTable, series, pledgeNo, releaseDate, interestAmount, hFormNo, callback) {
    console.log(`Updating ${ledgerTable} for series=${series}, pledgeNo=${pledgeNo}`);
    
    // Find the record in the Ledger table
    db.get(`
      SELECT * FROM ${ledgerTable} 
      WHERE series = ? AND pledge_no = ?
    `, [series, pledgeNo], (err, ledgerRecord) => {
      if (err) {
        console.error(`Error querying ${ledgerTable}:`, err);
        return callback(err);
      }
      
      if (!ledgerRecord) {
        console.warn(`No record found in ${ledgerTable} for series=${series}, pledgeNo=${pledgeNo}`);
        // Continue with the rest of the process even if ledger record doesn't exist
        return callback(null);
      }
      
      // Update the Ledger record with release information
      db.run(`
        UPDATE ${ledgerTable}
        SET release_date = ?,
            interest_amount = ?,
            h_from_no = ?
        WHERE series = ? AND pledge_no = ?
      `, [releaseDate, interestAmount, hFormNo, series, pledgeNo], function(updateErr) {
        if (updateErr) {
          console.error(`Error updating ${ledgerTable}:`, updateErr);
          return callback(updateErr);
        }
        
        if (this.changes === 0) {
          console.warn(`No rows were updated in ${ledgerTable} for series=${series}, pledgeNo=${pledgeNo}`);
        } else {
          console.log(`Successfully updated ${ledgerTable} for series=${series}, pledgeNo=${pledgeNo}`);
        }
        
        callback(null);
      });
    });
  }
  
  // Helper function to update or create Day Book entry (with callback)
  function updateDayBook(date, pledgeAmount, releaseAmount, interestReceived, additionalInterest, isSpecial, callback) {
    const dayBookTable = isSpecial ? 'S_Day_Book' : 'Day_Book';
    
    // Check if an entry for this date already exists
    db.get(`SELECT * FROM ${dayBookTable} WHERE "Date" = ?`, [date], (err, existingEntry) => {
      if (err) {
        console.error(`Error checking ${dayBookTable}:`, err);
        return callback(err);
      }
      
      if (existingEntry) {
        // Update existing entry
        const updatedReleaseAmount = (existingEntry["Release Amount"] || 0) + releaseAmount;
        const updatedInterestReceived = (existingEntry["Interest Received"] || 0) + interestReceived;
        const updatedAdditionalInterest = (existingEntry["Additional Interest Received"] || 0) + additionalInterest;
        const updatedTotal = (updatedReleaseAmount + updatedInterestReceived + updatedAdditionalInterest) - (existingEntry["Pledge Amount"] || 0);
        
        db.run(`
          UPDATE ${dayBookTable} 
          SET "Release Amount" = ?, 
              "Interest Received" = ?, 
              "Additional Interest Received" = ?, 
              "Total" = ?
          WHERE "Date" = ?
        `, [updatedReleaseAmount, updatedInterestReceived, updatedAdditionalInterest, updatedTotal, date], (updateErr) => {
          if (updateErr) {
            console.error(`Error updating ${dayBookTable}:`, updateErr);
            return callback(updateErr);
          }
          callback(null);
        });
      } else {
        // Create new entry
        const total = (releaseAmount + interestReceived + additionalInterest) - pledgeAmount;
        
        db.run(`
          INSERT INTO ${dayBookTable} (
            "Date", "Pledge Amount", "Release Amount", 
            "Interest Received", "Additional Interest Received", "Total"
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [date, pledgeAmount, releaseAmount, interestReceived, additionalInterest, total], (insertErr) => {
          if (insertErr) {
            console.error(`Error inserting into ${dayBookTable}:`, insertErr);
            return callback(insertErr);
          }
          callback(null);
        });
      }
    });
  }
  
  // Helper function to update Release Records (with callback)
  function updateReleaseRecords(date, billNo, releaseAmount, interestReceived, interestOnExpenses, goldWeight, silverWeight, isSpecial, callback) {
    const releaseRecordsTable = isSpecial ? 'S_Release_Records' : 'Release_Records';
    
    // Convert goldWeight and silverWeight to numbers (default to 0 if missing)
    const parsedGoldWeight = goldWeight ? parseFloat(goldWeight) : 0;
    const parsedSilverWeight = silverWeight ? parseFloat(silverWeight) : 0;
    
    // Build the query based on whether it's special or regular
    let query;
    let params;
    
    if (isSpecial) {
      query = `
        INSERT INTO ${releaseRecordsTable} (
          "Date", "Bill No", "Release Amount", "Interest Received", "Interest On Expenses"
        ) VALUES (?, ?, ?, ?, ?)
      `;
      params = [date, billNo, releaseAmount, interestReceived, interestOnExpenses];
    } else {
      query = `
        INSERT INTO ${releaseRecordsTable} (
          "Date", "Bill No", "Release Amount", "Interest Received", "Interest On Expenses",
          "Released Gold Weight", "Released Silver Weight"
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      params = [date, billNo, releaseAmount, interestReceived, interestOnExpenses, parsedGoldWeight, parsedSilverWeight];
    }
    
    db.run(query, params, (err) => {
      if (err) {
        console.error(`Error inserting into ${releaseRecordsTable}:`, err);
        return callback(err);
      }
      callback(null);
    });
  }
  
  // Helper function to update Insights table (subtract gold/silver) (with callback)
  function updateInsights(goldWeight, silverWeight, isSpecial, callback) {
    const insightsTable = isSpecial ? 'S_Insights_gold_silver' : 'Insights_gold_silver';
    
    // Convert goldWeight and silverWeight to numbers (default to 0 if missing)
    const parsedGoldWeight = goldWeight ? parseFloat(goldWeight) : 0;
    const parsedSilverWeight = silverWeight ? parseFloat(silverWeight) : 0;
    
    // First get current values
    db.get(`SELECT * FROM ${insightsTable} LIMIT 1`, [], (err, currentInsights) => {
      if (err) {
        console.error(`Error fetching from ${insightsTable}:`, err);
        return callback(err);
      }
      
      if (!currentInsights) {
        console.error(`No records found in ${insightsTable}`);
        return callback(new Error(`No records found in ${insightsTable}`));
      }
      
      // Calculate new values
      const newGoldInReserve = Math.max(0, (currentInsights["Gold in Reserve"] || 0) - parsedGoldWeight);
      const newSilverInReserve = Math.max(0, (currentInsights["Silver in Reserve"] || 0) - parsedSilverWeight);
      
      // Update insights table
      db.run(`
        UPDATE ${insightsTable} 
        SET "Gold in Reserve" = ?, 
            "Silver in Reserve" = ?
        WHERE rowid = ?
      `, [newGoldInReserve, newSilverInReserve, currentInsights.rowid || 1], (updateErr) => {
        if (updateErr) {
          console.error(`Error updating ${insightsTable}:`, updateErr);
          return callback(updateErr);
        }
        callback(null);
      });
    });
  }
  
  // Helper function to calculate interest based on time elapsed
  function calculateInterest(startDateStr, initialAmount) {
    // Parse initial amount (default to 0 if invalid)
    const principal = parseFloat(initialAmount) || 0;
    
    // Parse dates
    const startDate = new Date(startDateStr);
    const currentDate = new Date();
    
    // Validate date parsing
    if (isNaN(startDate.getTime())) {
      console.warn(`Invalid start date: ${startDateStr}, using current date as fallback`);
      startDate = new Date(); // Fallback to now, resulting in 0 interest
    }
    
    // Calculate difference in milliseconds
    const diffTime = Math.abs(currentDate - startDate);
    
    // Calculate days
    const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // Calculate months and remaining days
    let months = Math.floor(totalDays / 30);
    const remainingDays = totalDays % 30;
    
    // Round months based on remaining days
    if (remainingDays > 5) {
      months += 1;
    }
    
    // Calculate interest (16% per annum for regular interest)
    const monthlyInterestRate = 0.16 / 12; // 16% annually divided by 12 months
    const interestReceived = principal * monthlyInterestRate * months;
    
    // Calculate additional interest (8% per annum)
    const monthlyAdditionalRate = 0.08 / 12; // 8% annually divided by 12 months
    const additionalInterestReceived = principal * monthlyAdditionalRate * months;
    
    console.log("Interest calculation:", {
      principal,
      startDate: startDateStr,
      currentDate: currentDate.toISOString().split('T')[0],
      totalDays,
      months,
      interestReceived: Math.round(interestReceived),
      additionalInterestReceived: Math.round(additionalInterestReceived)
    });
    
    return {
      interestReceived: Math.round(interestReceived),
      additionalInterestReceived: Math.round(additionalInterestReceived)
    };
  }
});


// Add this route to your server.js file

app.get('/calculate-interest', (req, res) => {
  const billNumber = req.query.billNumber;
  
  // If no bill number provided, just render the search form
  if (!billNumber) {
    return res.render('calculate-interest', { 
      bill: null, 
      error: null, 
      searchBillNumber: '', 
      calculationResult: null
    });
  }

  // If bill number is provided, query the database - now including silver tables
  // Using LIKE with % to handle potential prefix/suffix inconsistencies
  const query = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History"
    FROM active_pledges 
    WHERE "Bill Number" LIKE ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History"
    FROM S_active_pledges 
    WHERE "Bill Number" LIKE ?
  `;
  
  // Search with flexibility for bill number format
  const searchPattern = `%${billNumber}%`;
  
  db.get(query, [searchPattern, searchPattern], (err, bill) => {
    if (err) {
      console.error("Database error:", err);
      return res.render('calculate-interest', { 
        bill: null, 
        error: 'Error fetching bill: ' + err.message,
        searchBillNumber: billNumber,
        calculationResult: null
      });
    } 
    
    if (!bill) {
      console.log(`Bill not found: ${billNumber}`);
      return res.render('calculate-interest', { 
        bill: null, 
        error: 'Bill not found',
        searchBillNumber: billNumber,
        calculationResult: null
      });
    } 
    
    // Parse JSON data from database
    try {
      if (bill["Principle_Adding_His"]) {
        bill["Principle_Adding_His"] = JSON.parse(bill["Principle_Adding_His"]);
      } else {
        bill["Principle_Adding_His"] = {};
      }
      
      if (bill["Repay History"]) {
        bill["Repay History"] = JSON.parse(bill["Repay History"]);
      } else {
        bill["Repay History"] = {};
      }
    } catch (e) {
      console.error("Error parsing bill data:", e);
      return res.render('calculate-interest', { 
        bill: null, 
        error: 'Error parsing bill data: ' + e.message,
        searchBillNumber: billNumber,
        calculationResult: null
      });
    }
    
    // Successfully found the bill
    // console.log(`Found bill for interest calculation: ${bill["Bill Number"]}`);
    res.render('calculate-interest', { 
      bill, 
      error: null,
      searchBillNumber: billNumber,
      calculationResult: null
    });
  });
});

// New route to handle calculation
app.post('/calculate-interest', (req, res) => {
  const { 
    billNumber, 
    interestRate, 
    interestType, // 'monthly' or 'yearly'
    calculationDate 
  } = req.body;
  
  // Fetch the bill from database - now including silver tables
  const query = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", 'active_pledges' as "Table"
    FROM active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address", 
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
           "Remarks", "Interest Rate", "Initial Pledged Amount", 
           "Principle_Adding_His", "Repay History", 'S_active_pledges' as "Table"
    FROM S_active_pledges 
    WHERE "Bill Number" = ?
  `;
  
  db.get(query, [billNumber, billNumber], (err, bill) => {
    if (err || !bill) {
      console.error(err ? `Database error during calculation: ${err}` : `Bill not found for calculation: ${billNumber}`);
      return res.render('calculate-interest', { 
        bill: null, 
        error: err ? 'Error fetching bill: ' + err.message : 'Bill not found',
        searchBillNumber: billNumber,
        calculationResult: null
      });
    }
    
    // Parse JSON data
    try {
      if (bill["Principle_Adding_His"]) {
        bill["Principle_Adding_His"] = JSON.parse(bill["Principle_Adding_His"]);
      } else {
        bill["Principle_Adding_His"] = {};
      }
      
      if (bill["Repay History"]) {
        bill["Repay History"] = JSON.parse(bill["Repay History"]);
      } else {
        bill["Repay History"] = {};
      }
    } catch (e) {
      console.error("Error parsing bill data for calculation:", e);
      return res.render('calculate-interest', { 
        bill: null, 
        error: 'Error parsing bill data: ' + e.message,
        searchBillNumber: billNumber,
        calculationResult: null
      });
    }
    
    console.log(`Calculating interest for bill ${billNumber} (${bill.Table})`);
    
    // Calculate interest and amount
    const calculationResult = calculateInterestAndAmount(
      bill, 
      parseFloat(interestRate), 
      interestType,
      calculationDate
    );
    
    // Render the results
    res.render('calculate-interest', {
      bill,
      error: null,
      searchBillNumber: billNumber,
      calculationResult,
      interestRate,
      interestType,
      calculationDate
    });
  });
});

// Function to calculate interest and total amount
function calculateInterestAndAmount(bill, interestRate, interestType, calculationDate) {
  // Convert dates to proper format
  const initialDate = parseDate(bill["Date"]);
  const currentDate = calculationDate ? parseDate(calculationDate) : new Date();
  
  // Convert interest rate to monthly if it's yearly
  const monthlyInterestRate = interestType === 'yearly' ? interestRate / 12 : interestRate;
  
  // Sort all transactions by date
  const transactions = [];
  
  // Add initial pledge
  transactions.push({
    date: initialDate,
    type: 'initial',
    amount: parseFloat(bill["Initial Pledged Amount"])
  });
  
  // Add principal additions
  for (const [dateStr, amount] of Object.entries(bill["Principle_Adding_His"] || {})) {
    transactions.push({
      date: parseDate(dateStr),
      type: 'addition',
      amount: parseFloat(amount)
    });
  }
  
  // Add repayments
  for (const [dateStr, amount] of Object.entries(bill["Repay History"] || {})) {
    transactions.push({
      date: parseDate(dateStr),
      type: 'repayment',
      amount: parseFloat(amount)
    });
  }
  
  // Sort transactions by date
  transactions.sort((a, b) => a.date - b.date);
  
  // Calculate interest periods and amounts
  let principal = 0;
  let totalInterest = 0;
  let remainingPrincipal = 0;
  const interestDetails = [];
  
  for (let i = 0; i < transactions.length; i++) {
    const currentTx = transactions[i];
    const nextTx = i < transactions.length - 1 ? transactions[i + 1] : null;
    
    // Update principal based on transaction type
    if (currentTx.type === 'initial' || currentTx.type === 'addition') {
      principal += currentTx.amount;
    }
    
    // Calculate interest for this period
    if (nextTx) {
      // Calculate months between current and next transaction
      const months = calculateMonths(currentTx.date, nextTx.date);
      
      // Calculate interest for this period
      const periodInterest = principal * (monthlyInterestRate / 100) * months;
      totalInterest += periodInterest;
      
      interestDetails.push({
        fromDate: formatDate(currentTx.date),
        toDate: formatDate(nextTx.date),
        months: months,
        principal: principal,
        interest: periodInterest
      });
      
      // If next transaction is repayment, adjust principal
      if (nextTx.type === 'repayment') {
        // First apply repayment to accumulated interest
        const interestPaid = Math.min(nextTx.amount, totalInterest);
        totalInterest -= interestPaid;
        
        // Apply remaining amount to principal
        const principalPaid = nextTx.amount - interestPaid;
        principal -= principalPaid;
      }
    } else {
      // Last transaction to current date
      const months = calculateMonths(currentTx.date, currentDate);
      
      // Calculate interest for final period
      const periodInterest = principal * (monthlyInterestRate / 100) * months;
      totalInterest += periodInterest;
      
      interestDetails.push({
        fromDate: formatDate(currentTx.date),
        toDate: formatDate(currentDate),
        months: months,
        principal: principal,
        interest: periodInterest
      });
      
      remainingPrincipal = principal;
    }
  }
  
  return {
    interestDetails: interestDetails,
    totalInterest: totalInterest,
    remainingPrincipal: remainingPrincipal,
    totalAmount: remainingPrincipal + totalInterest
  };
}

// Helper function to calculate months between two dates
// Rounds up if decimal part is > 0.2
function calculateMonths(startDate, endDate) {
  const yearDiff = endDate.getFullYear() - startDate.getFullYear();
  const monthDiff = endDate.getMonth() - startDate.getMonth();
  const dayDiff = endDate.getDate() - startDate.getDate();
  
  let months = yearDiff * 12 + monthDiff;
  
  // Add partial month if day difference makes it > 0.2 of a month
  if (dayDiff > 0) {
    const daysInMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
    const monthFraction = dayDiff / daysInMonth;
    
    if (monthFraction > 0.2) {
      months += 1;
    }
  } else if (dayDiff < 0) {
    const daysInPrevMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 0).getDate();
    const monthFraction = (daysInPrevMonth + dayDiff) / daysInPrevMonth;
    
    // This ensures we don't double-count when exactly 1 month has passed
    months -= 1;
    if (monthFraction > 0.2) {
      months += 1;
    }
  }
  
  return months;
}

// Helper function to parse date string (supports multiple formats)
function parseDate(dateStr) {
  // Check if dateStr is already a Date object
  if (dateStr instanceof Date) return dateStr;
  
  // Try different date formats (DD-MM-YYYY, YYYY-MM-DD)
  const formats = [
    { regex: /^(\d{2})-(\d{2})-(\d{4})$/, order: [2, 1, 0] }, // DD-MM-YYYY
    { regex: /^(\d{4})-(\d{2})-(\d{2})$/, order: [0, 1, 2] }  // YYYY-MM-DD
  ];
  
  for (const format of formats) {
    const match = dateStr.match(format.regex);
    if (match) {
      const [_, part1, part2, part3] = match;
      const parts = [part1, part2, part3];
      const [yearPart, monthPart, dayPart] = format.order.map(i => parts[i]);
      
      return new Date(
        parseInt(yearPart), 
        parseInt(monthPart) - 1, // JavaScript months are 0-indexed
        parseInt(dayPart)
      );
    }
  }
  
  // If no pattern matches, try built-in Date parsing
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Default to current date if invalid
  console.error(`Invalid date format: ${dateStr}`);
  return new Date();
}

// Helper function to format date to DD-MM-YYYY
function formatDate(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  
  return `${day}-${month}-${year}`;
}

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Close the database connection when the server stops
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});