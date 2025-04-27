const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = require('./db'); // Import your database connection

// Function to generate a random number between min and max (inclusive)
function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Function to generate a date string in 'YYYY-MM-DD' format
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Generate dummy data for the past 3 years
async function generateDummyData() {
  // Calculate the date 3 years ago from today
  const endDate = new Date(); // Today
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 3);
  
  console.log(`Generating dummy data from ${formatDate(startDate)} to ${formatDate(endDate)}`);
  
  // Loop through each day in the date range
  const currentDate = new Date(startDate);
  
  // Create arrays to store the data
  const dayBookData = [];
  const sDayBookData = [];
  
  while (currentDate <= endDate) {
    const dateStr = formatDate(currentDate);
    
    // Generate random values for Day_Book
    const pledgeAmount = getRandomNumber(1000, 10000);
    const releaseAmount = getRandomNumber(1000, 10000);
    const interestReceived = getRandomNumber(160, 1600);
    const additionalInterestReceived = getRandomNumber(160, 1600);
    const total = releaseAmount + interestReceived + additionalInterestReceived - pledgeAmount;
    
    // Generate random values for S_Day_Book (similar but different values)
    const sPledgeAmount = getRandomNumber(1000, 10000);
    const sReleaseAmount = getRandomNumber(1000, 10000);
    const sInterestReceived = getRandomNumber(160, 1600);
    const sAdditionalInterestReceived = getRandomNumber(160, 1600);
    const sTotal = sReleaseAmount + sInterestReceived + sAdditionalInterestReceived - sPledgeAmount;
    
    dayBookData.push({
      date: dateStr,
      pledgeAmount,
      releaseAmount,
      interestReceived,
      additionalInterestReceived,
      total
    });
    
    sDayBookData.push({
      date: dateStr,
      pledgeAmount: sPledgeAmount,
      releaseAmount: sReleaseAmount,
      interestReceived: sInterestReceived,
      additionalInterestReceived: sAdditionalInterestReceived,
      total: sTotal
    });
    
    // Move to the next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Insert data into Day_Book table
  const dayBookPromises = dayBookData.map(data => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO Day_Book ("Date", "Pledge Amount", "Release Amount", "Interest Received", "Additional Interest Received", "Total") 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [data.date, data.pledgeAmount, data.releaseAmount, data.interestReceived, data.additionalInterestReceived, data.total],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  });
  
  // Insert data into S_Day_Book table
  const sDayBookPromises = sDayBookData.map(data => {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO S_Day_Book ("Date", "Pledge Amount", "Release Amount", "Interest Received", "Additional Interest Received", "Total") 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [data.date, data.pledgeAmount, data.releaseAmount, data.interestReceived, data.additionalInterestReceived, data.total],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  });
  
  try {
    // Wait for all inserts to complete
    await Promise.all([...dayBookPromises, ...sDayBookPromises]);
    console.log(`Successfully inserted ${dayBookData.length} records into Day_Book table`);
    console.log(`Successfully inserted ${sDayBookData.length} records into S_Day_Book table`);
  } catch (error) {
    console.error('Error inserting dummy data:', error);
  }
}

// Execute the function
generateDummyData().then(() => {
  console.log('Dummy data generation complete');
  // Close database connection when done
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
  });
}).catch(err => {
  console.error('Error:', err);
  db.close();
});