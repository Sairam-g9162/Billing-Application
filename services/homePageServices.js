// services/billService.js

const moment = require('moment');
const db = require('../database/db');
const excel = require('exceljs'); 


const fetchReleasedBills = () => {
  return new Promise((resolve, reject) => {
    const today = moment().format('YYYY-MM-DD');
    const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');
    
    const regularQuery = `SELECT "Bill No", Date FROM Release_Records WHERE Date IN (?, ?)`;
    const sQuery = `SELECT "Bill No", Date FROM S_Release_Records WHERE Date IN (?, ?)`;

    const todayReleasedBills = [];
    const yesterdayReleasedBills = [];
    
    db.all(regularQuery, [today, yesterday], (err, rows) => {
      if (err) {
        console.error('Error querying Release_Records:', err.message);
        reject(err);
        return;
      }
      
      rows.forEach(row => {
        if (row.Date === today) {
          todayReleasedBills.push(row['Bill No']);
        } else if (row.Date === yesterday) {
          yesterdayReleasedBills.push(row['Bill No']);
        }
      });
      
      db.all(sQuery, [today, yesterday], (err, sRows) => {
        if (err) {
          console.error('Error querying S_Release_Records:', err.message);
          reject(err);
          return;
        }
        
        sRows.forEach(row => {
          if (row.Date === today) {
            todayReleasedBills.push(row['Bill No']);
          } else if (row.Date === yesterday) {
            yesterdayReleasedBills.push(row['Bill No']);
          }
        });
        
        todayReleasedBills.sort();
        yesterdayReleasedBills.sort();
        
        resolve({
          todayReleasedBills,
          yesterdayReleasedBills
        });
      });
    });
  });
};


const fetchDetailedBillsForExcel = (dateType) => {
  return new Promise((resolve, reject) => {
    const today = moment().format('YYYY-MM-DD');
    const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');
    
    const targetDate = dateType === 'today' ? today : yesterday;
    
    // Get bill numbers from Release_Records and S_Release_Records
    const billNumbersQuery = `
      SELECT "Bill No" FROM Release_Records WHERE Date = ?
      UNION
      SELECT "Bill No" FROM S_Release_Records WHERE Date = ?
    `;
    
    db.all(billNumbersQuery, [targetDate, targetDate], (err, billRows) => {
      if (err) {
        console.error('Error fetching bill numbers:', err.message);
        reject(err);
        return;
      }
      
      const billNumbers = billRows.map(row => row['Bill No']);
      
      if (billNumbers.length === 0) {
        resolve([]);
        return;
      }
      
      // Create placeholders for SQL IN clause
      const placeholders = billNumbers.map(() => '?').join(',');
      
      // Query for detailed information from Released_Pledges
      const detailedQuery = `
        SELECT 
          "Bill Number" AS "Bill No", 
          "Name", 
          "Date" AS "PledgeDate", 
          "Items", 
          "Initial Pledged Amount" AS "Amount" 
        FROM Released_Pledges
        WHERE "Bill Number" IN (${placeholders})
      `;
      
      // Query for detailed information from S_Released_Pledges
      const sDetailedQuery = `
        SELECT 
          "Bill Number" AS "Bill No", 
          "Name", 
          "Date" AS "PledgeDate", 
          "Items", 
          "Initial Pledged Amount" AS "Amount" 
        FROM S_Released_Pledges
        WHERE "Bill Number" IN (${placeholders})
      `;
      
      const detailedBills = [];
      
      db.all(detailedQuery, billNumbers, (err, detailedRows) => {
        if (err) {
          console.error('Error querying Released_Pledges:', err.message);
          reject(err);
          return;
        }
        
        detailedBills.push(...detailedRows);
        
        db.all(sDetailedQuery, billNumbers, (err, sDetailedRows) => {
          if (err) {
            console.error('Error querying S_Released_Pledges:', err.message);
            reject(err);
            return;
          }
          
          detailedBills.push(...sDetailedRows);
          resolve(detailedBills);
        });
      });
    });
  });
};

const generateExcelFile = async (dateType) => {
  try {
    const bills = await fetchDetailedBillsForExcel(dateType);
    
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Released Bills');
    
    // Add columns
    worksheet.columns = [
      { header: 'Bill No', key: 'Bill No', width: 15 },
      { header: 'Name', key: 'Name', width: 30 },
      { header: 'Pledge Date', key: 'PledgeDate', width: 15 },
      { header: 'Items', key: 'Items', width: 30 },
      { header: 'Amount', key: 'Amount', width: 15 }
    ];
    
    // Add style to header row
    worksheet.getRow(1).font = { bold: true };
    
    // Add data
    worksheet.addRows(bills);
    
    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  } catch (err) {
    console.error('Error generating Excel file:', err);
    throw err;
  }
};

module.exports = {
  fetchReleasedBills,
  fetchDetailedBillsForExcel,
  generateExcelFile
};



module.exports = {
  fetchReleasedBills,
  generateExcelFile
};
