const express = require('express');
const path = require('path');
const db = require('./database/db');
const ExcelJS = require('exceljs');
const fs = require('fs-extra'); // Import the database connection
const app = express();
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const moment = require('moment');


// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (CSS) from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.render('index'); // Home page
});
app.get('/backup-interface', (req, res) => {
  res.render('backup');
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

// Update the POST route to handle both tables
app.post('/add-bill', (req, res) => {
  const {
    billNumber, name, date, phoneNumber, address, aadharNumber,
    goldSilver, noOfItems, items, remarks, interestRate, initialPledgedAmount,
    principleAddingHis, repayHistory, useSeries
  } = req.body;
  
  try {
    // Parse the items JSON object from the form
    const itemsObject = items ? JSON.parse(items) : {};
    
    // Prepare data for insertion
    const data = [
      billNumber, name, date, phoneNumber, address, aadharNumber || null,
      goldSilver, noOfItems, JSON.stringify(itemsObject), remarks || null,
      interestRate, initialPledgedAmount,
      principleAddingHis || JSON.stringify({}),
      repayHistory || JSON.stringify({})
    ];
    
    // Determine which table to use based on the checkbox
    const tableName = useSeries === 'on' ? 'S_active_pledges' : 'active_pledges';
    
    // Insert into the appropriate table
    db.run(`
      INSERT INTO ${tableName} (
        "Bill Number", "Name", "Date", "Phone Number", "Address", 
        "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
        "Remarks", "Interest Rate", "Initial Pledged Amount", 
        "Principle_Adding_His", "Repay History"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, data, (err) => {
      if (err) {
        console.error(`Error inserting into ${tableName}:`, err.message);
        res.render('addBill', { 
          error: 'Error adding bill: ' + err.message, 
          success: null,
          nextBillNumber: billNumber 
        });
      } else {
        // Redirect to print-bill page with the bill number and table info
        res.redirect(`/print-bill?billNumber=${billNumber}&tableName=${tableName}`);
      }
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
  
  // If no bill number provided, just render the search form
  if (!billNumber) {
    return res.render('printBill', {
      bill: null,
      error: null,
      searchBillNumber: ''
    });
  }
  
  // If bill number is provided, query the database
  const query = `
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address",
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items",
           "Remarks", "Interest Rate", "Initial Pledged Amount",
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'Active' as "Status"
    FROM active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address",
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items",
           "Remarks", "Interest Rate", "Initial Pledged Amount",
           "Principle_Adding_His", "Repay History", NULL as "Released Date", NULL as "Released Remarks", 'S_Active' as "Status"
    FROM S_active_pledges 
    WHERE "Bill Number" = ?
    UNION
    SELECT "Bill Number", "Name", "Date", "Phone Number", "Address",
           "Aadhar_Number", "Gold/Silver", "No_of_items", "Items",
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
    
    // Successfully found the bill
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

// POST route to handle bill release
// POST route to handle bill release
app.post('/release-bill', (req, res) => {
  const { billNumber, remarks } = req.body;
  
  if (!billNumber || !remarks) {
    return res.redirect('/release?billNumber=' + billNumber + '&error=Missing required fields');
  }
  
  // Start a transaction to ensure data consistency
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // First check active_pledges
    db.get('SELECT *, "Regular" as "Type" FROM active_pledges WHERE "Bill Number" = ?', [billNumber], (err, bill) => {
      if (err) {
        db.run('ROLLBACK');
        return res.redirect('/release?billNumber=' + billNumber + '&error=' + encodeURIComponent('Database error: ' + err.message));
      }
      
      // If not found in active_pledges, check S_active_pledges
      if (!bill) {
        db.get('SELECT *, "Special" as "Type" FROM S_active_pledges WHERE "Bill Number" = ?', [billNumber], (err, specialBill) => {
          if (err) {
            db.run('ROLLBACK');
            return res.redirect('/release?billNumber=' + billNumber + '&error=' + encodeURIComponent('Database error: ' + err.message));
          }
          
          if (!specialBill) {
            db.run('ROLLBACK');
            return res.redirect('/release?billNumber=' + billNumber + '&error=Bill not found or already released');
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
  
  // Helper function to process the release
  function processRelease(bill, remarks, isSpecial, res) {
    // Current date for the released_date field
    const releasedDate = new Date().toISOString().split('T')[0];
    
    // Determine which tables to use based on isSpecial flag
    const activeTable = isSpecial ? 'S_active_pledges' : 'active_pledges';
    const releasedTable = isSpecial ? 'S_released_pledges' : 'released_pledges';
    
    // Insert into released_pledges or S_released_pledges
    const insertQuery = `
      INSERT INTO ${releasedTable} (
        "Bill Number", "Name", "Date", "Phone Number", "Address", 
        "Aadhar_Number", "Gold/Silver", "No_of_items", "Items", 
        "Remarks", "Interest Rate", "Initial Pledged Amount", 
        "Principle_Adding_His", "Repay History", "Released Date", "Released Remarks"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(insertQuery, [
      bill["Bill Number"], 
      bill["Name"], 
      bill["Date"], 
      bill["Phone Number"], 
      bill["Address"], 
      bill["Aadhar_Number"], 
      bill["Gold/Silver"], 
      bill["No_of_items"], 
      bill["Items"], 
      bill["Remarks"], 
      bill["Interest Rate"], 
      bill["Initial Pledged Amount"], 
      bill["Principle_Adding_His"], 
      bill["Repay History"], 
      releasedDate, 
      remarks
    ], function(insertErr) {
      if (insertErr) {
        db.run('ROLLBACK');
        return res.redirect('/release?billNumber=' + bill["Bill Number"] + '&error=' + encodeURIComponent(`Error inserting into ${releasedTable}: ` + insertErr.message));
      }
      
      // Delete from active_pledges or S_active_pledges
      db.run(`DELETE FROM ${activeTable} WHERE "Bill Number" = ?`, [bill["Bill Number"]], function(deleteErr) {
        if (deleteErr) {
          db.run('ROLLBACK');
          return res.redirect('/release?billNumber=' + bill["Bill Number"] + '&error=' + encodeURIComponent(`Error deleting from ${activeTable}: ` + deleteErr.message));
        }
        
        // Commit the transaction if everything was successful
        db.run('COMMIT', function(commitErr) {
          if (commitErr) {
            db.run('ROLLBACK');
            return res.redirect('/release?billNumber=' + bill["Bill Number"] + '&error=' + encodeURIComponent('Error committing transaction: ' + commitErr.message));
          }
          
          // Redirect to release page with success message
          return res.redirect('/release?billNumber=' + bill["Bill Number"] + '&success=Bill successfully released');
        });
      });
    });
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