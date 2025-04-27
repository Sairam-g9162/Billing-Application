const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to SQLite database (creates bill_management.db if it doesn’t exist)
const db = new sqlite3.Database(path.join(__dirname, 'bill_management.db'), (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create tables
db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS Ledger (
      series TEXT NOT NULL,
      pledge_no INTEGER NOT NULL,
      pledge_date DATE NOT NULL,
      name TEXT NOT NULL,
      father_spouse_name TEXT NOT NULL,
      town_city TEXT NOT NULL,
      principal_amount REAL NOT NULL,
      interest REAL NOT NULL,
      item_description JSON NOT NULL,
      weights JSON NOT NULL,
      value REAL NOT NULL,
      time_agreed DATE NOT NULL,
      release_date DATE,
      h_from_no TEXT,
      principal REAL,
      interest_amount REAL,
      PRIMARY KEY (series, pledge_no)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating Ledger table:', err.message);
    } else {
      console.log('Ledger table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS S_Ledger (
      series TEXT NOT NULL,
      pledge_no INTEGER NOT NULL,
      pledge_date DATE NOT NULL,
      name TEXT NOT NULL,
      father_spouse_name TEXT NOT NULL,
      town_city TEXT NOT NULL,
      principal_amount REAL NOT NULL,
      interest REAL NOT NULL,
      item_description JSON NOT NULL,
      weights JSON NOT NULL,
      value REAL NOT NULL,
      time_agreed DATE NOT NULL,
      release_date DATE,
      h_from_no TEXT,
      principal REAL,
      interest_amount REAL,
      PRIMARY KEY (series, pledge_no)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating S Ledger table:', err.message);
    } else {
      console.log(' S Ledger table created or already exists.');
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS active_pledges (
      "Bill Number" TEXT PRIMARY KEY NOT NULL,
      "Name" TEXT NOT NULL,
      "FatherorSpouseName" TEXT NOT NULL,
      "Date" DATE NOT NULL,
      "Phone Number" INTEGER NOT NULL,
      "Address" TEXT,
      "townOrCity" TEXT NOT NULL,
      "Aadhar_Number" INTEGER,
      "Gold/Silver" TEXT NOT NULL,
      "No_of_items" INTEGER NOT NULL,
      "Items" TEXT NOT NULL,
      "Remarks" TEXT,
      "Interest Rate" INTEGER NOT NULL,
      "Initial Pledged Amount" INTEGER NOT NULL,
      "Items_Value" TEXT NOT NULL,
      "Silver_Gross_Weight" TEXT,
      "Gold_Gross_Weight" TEXT,
      "Principle_Adding_His" TEXT,
      "Repay History" TEXT
    )
  `, (err) => {
    if (err) {
      console.error('Error creating active_pledges table:', err.message);
    } else {
      console.log('active_pledges table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS S_active_pledges (
      "Bill Number" TEXT PRIMARY KEY NOT NULL,
      "Name" TEXT NOT NULL,
      "FatherorSpouseName" TEXT NOT NULL,
      "Date" DATE NOT NULL,
      "Phone Number" INTEGER NOT NULL,
      "Address" TEXT,
      "townOrCity" TEXT NOT NULL,
      "Aadhar_Number" INTEGER,
      "Items" TEXT NOT NULL,
      "Gold/Silver" TEXT NOT NULL,
      "No_of_items" INTEGER NOT NULL, 
      "Remarks" TEXT,
      "Interest Rate" INTEGER NOT NULL,
      "Initial Pledged Amount" INTEGER NOT NULL,
      "Items_Value" TEXT NOT NULL,
      "Silver_Gross_Weight" TEXT,
      "Gold_Gross_Weight" TEXT,
      "Principle_Adding_His" TEXT,
      "Repay History" TEXT
    )
  `, (err) => {
    if (err) {
      console.error('Error creating S_active_pledges table:', err.message);
    } else {
      console.log('S_active_pledges table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS released_pledges (
      "Bill Number" TEXT PRIMARY KEY NOT NULL,
      "Name" TEXT NOT NULL,
      "FatherorSpouseName" TEXT NOT NULL,
      "Date" DATE NOT NULL,
      "Phone Number" INTEGER,
      "Address" TEXT,
      "townOrCity" TEXT NOT NULL,
      "Aadhar_Number" INTEGER,
      "Gold/Silver" TEXT NOT NULL,
      "No_of_items" INTEGER NOT NULL,
      "Items" TEXT NOT NULL,
      "Remarks" TEXT,
      "Interest Rate" INTEGER NOT NULL,
      "Initial Pledged Amount" INTEGER NOT NULL,
      "Items_Value" TEXT NOT NULL,
      "Silver_Gross_Weight" TEXT,
      "Gold_Gross_Weight" TEXT,
      "Principle_Adding_His" TEXT,
      "Repay History" TEXT,
      "Released Date" DATE NOT NULL,
      "Released Remarks" TEXT
      "Interest_Received" INTEGER NOT NULL,
      "Additional_Interest" INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating released_pledges table:', err.message);
    } else {
      console.log('released_pledges table created or already exists.');
    }
  });
   db.run(`
    CREATE TABLE IF NOT EXISTS S_released_pledges (
      "Bill Number" TEXT PRIMARY KEY NOT NULL,
      "Name" TEXT NOT NULL,
      "FatherorSpouseName" TEXT NOT NULL,
      "Date" DATE NOT NULL,
      "Phone Number" INTEGERJ,
      "Address" TEXT,
      "townOrCity" TEXT NOT NULL,
      "Aadhar_Number" INTEGER,
      "Gold/Silver" TEXT NOT NULL,
      "No_of_items" INTEGER NOT NULL,
      "Items" TEXT NOT NULL,
      "Remarks" TEXT,
      "Interest Rate" INTEGER NOT NULL,
      "Initial Pledged Amount" INTEGER NOT NULL,
      "Items_Value" TEXT NOT NULL,
      "Silver_Gross_Weight" TEXT,
      "Gold_Gross_Weight" TEXT,
      "Principle_Adding_His" TEXT,
      "Repay History" TEXT,
      "Released Date" DATE NOT NULL,
      "Released Remarks" TEXT,
      "Interest_Received" INTEGER NOT NULL,
      "Additional_Interest" INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating S_released_pledges table:', err.message);
    } else {
      console.log('S_released_pledges table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS Day_Book (
      "Date" DATE NOT NULL,
      "Pledge Amount" INTEGER NOT NULL,
      "Release Amount" INTEGER NOT NULL,
      "Interest Received" INTEGER NOT NULL,
      "Additional Interest Received" INTEGER NOT NULL,
      "Total" INTEGER NOT NULL,
      PRIMARY KEY ("Date")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating Day_Book table:', err.message);
    } else {
      console.log('Day_Book table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS Pledge_Records (
      "Date" DATE NOT NULL,
      "Bill No" TEXT NOT NULL,
      "Pledge Amount" INTEGER NOT NULL,
      "Pledged Gold Weight" INTEGER NOT NULL,
      "Pledged Silver Weight" INTEGER NOT NULL,
      PRIMARY KEY ("Date", "Bill No")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating Pledge_Records table:', err.message);
    } else {
      console.log('Pledge_Records table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS Release_Records (
      "Date" DATE NOT NULL,
      "Bill No" TEXT NOT NULL,
      "Release Amount" INTEGER NOT NULL,
      "Interest Received" INTEGER NOT NULL,
      "Interest On Expenses" INTEGER NOT NULL,
      "Released Gold Weight" INTEGER NOT NULL,
      "Released Silver Weight" INTEGER NOT NULL,
      PRIMARY KEY ("Date", "Bill No")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating Release_Records table:', err.message);
    } else {
      console.log('Release_Records table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS Insights_gold_silver (
      "Gold in Reserve" INTEGER NOT NULL,
      "Silver in Reserve" INTEGER NOT NULL,
      PRIMARY KEY ("Gold in Reserve", "Silver in Reserve")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating Insights_gold_silver table:', err.message);
    } else {
      console.log('Insights_gold_silver table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS S_Day_Book (
      "Date" DATE NOT NULL,
      "Pledge Amount" INTEGER NOT NULL,
      "Release Amount" INTEGER NOT NULL,
      "Interest Received" INTEGER NOT NULL,
      "Additional Interest Received" INTEGER NOT NULL,
      "Total" INTEGER NOT NULL,
      PRIMARY KEY ("Date")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating S_Day_Book table:', err.message);
    } else {
      console.log('S_Day_Book table created or already exists.');
    }
  });
  
  db.run(`
    CREATE TABLE IF NOT EXISTS S_Pledge_Records (
      "Date" DATE NOT NULL,
      "Bill No" TEXT NOT NULL,
      "Pledge Amount" INTEGER NOT NULL,
      "Pledged Gold Weight" INTEGER NOT NULL,
      "Pledged Silver Weight" INTEGER NOT NULL,
      PRIMARY KEY ("Date", "Bill No")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating S_Pledge_Records table:', err.message);
    } else {
      console.log('S_Pledge_Records table created or already exists.');
    }
  });
  
  db.run(`
    CREATE TABLE IF NOT EXISTS S_Release_Records (
      "Date" DATE NOT NULL,
      "Bill No" TEXT NOT NULL,
      "Release Amount" INTEGER NOT NULL,
      "Interest Received" INTEGER NOT NULL,
      "Interest On Expenses" INTEGER NOT NULL,
      PRIMARY KEY ("Date", "Bill No")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating S_Release_Records table:', err.message);
    } else {
      console.log('S_Release_Records table created or already exists.');
    }
  });
  
  db.run(`
    CREATE TABLE IF NOT EXISTS S_Insights_gold_silver (
      "Gold in Reserve" INTEGER NOT NULL,
      "Silver in Reserve" INTEGER NOT NULL,
      PRIMARY KEY ("Gold in Reserve", "Silver in Reserve")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating S_Insights_gold_silver table:', err.message);
    } else {
      console.log('S_Insights_gold_silver table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS S_Expenses (
      "Date" DATE NOT NULL,
      "Expense Details" JSON NOT NULL,
      "Total Expense" INTEGER NOT NULL,
      PRIMARY KEY ("Date")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating S_Expense table:', err.message);
    } else {
      console.log('S_Expense table created or already exists.');
    }
  });
  db.run(`
    CREATE TABLE IF NOT EXISTS Expenses (
      "Date" DATE NOT NULL,
      "Expense Details" JSON NOT NULL,
      "Total Expense" INTEGER NOT NULL,
      PRIMARY KEY ("Date")
    )
  `, (err) => {
    if (err) {
      console.error('Error creating Expense table:', err.message);
    } else {
      console.log('Expense table created or already exists.');
    }
  });

  

});


module.exports = db;