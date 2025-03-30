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
  // Create active_pledges table
  db.run(`
    CREATE TABLE IF NOT EXISTS active_pledges (
      "Bill Number" TEXT PRIMARY KEY NOT NULL,
      "Name" TEXT NOT NULL,
      "Date" DATE NOT NULL,
      "Phone Number" INTEGER NOT NULL,
      "Address" TEXT NOT NULL,
      "Aadhar_Number" INTEGER,
      "Gold/Silver" TEXT NOT NULL,
      "No_of_items" INTEGER NOT NULL,
      "Items" TEXT NOT NULL,
      "Remarks" TEXT,
      "Interest Rate" INTEGER NOT NULL,
      "Initial Pledged Amount" INTEGER NOT NULL,
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

  // Create released_pledges table
  db.run(`
    CREATE TABLE IF NOT EXISTS released_pledges (
      "Bill Number" TEXT PRIMARY KEY NOT NULL,
      "Name" TEXT NOT NULL,
      "Date" DATE NOT NULL,
      "Phone Number" INTEGER NOT NULL,
      "Address" TEXT NOT NULL,
      "Aadhar_Number" INTEGER,
      "Gold/Silver" TEXT NOT NULL,
      "No_of_items" INTEGER NOT NULL,
      "Items" TEXT NOT NULL,
      "Remarks" TEXT,
      "Interest Rate" INTEGER NOT NULL,
      "Initial Pledged Amount" INTEGER NOT NULL,
      "Principle_Adding_His" TEXT,
      "Repay History" TEXT,
      "Released Date" DATE NOT NULL,
      "Released Remarks" TEXT
    )
  `, (err) => {
    if (err) {
      console.error('Error creating released_pledges table:', err.message);
    } else {
      console.log('released_pledges table created or already exists.');
    }
  });
});

// Export the database connection
module.exports = db;