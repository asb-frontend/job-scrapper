// Web scraper for jobs.nvoids.com using Node.js with Puppeteer
// This script will navigate to the job search page and extract job listings

const puppeteer = require('puppeteer');
const fs = require('fs');
const ExcelJS = require('exceljs'); // Add ExcelJS for Excel output

// Main function to parse command line arguments and run the search
async function main() {
  // Get the job query from command line arguments
  const args = process.argv.slice(2);
  const jobQuery = args[0] || '';
  const numPages = parseInt(args[1]) || 3; // Default to 3 pages if not specified
  
  if (!jobQuery) {
    console.log('Please provide a job title to search for.');
    console.log('Usage: node job-scraper.js "job title" [numberOfPages]');
    console.log('Example: node job-scraper.js "software engineer" 3');
    return;
  }
  
  console.log(`Searching for "${jobQuery}" jobs...`);
  
  // Start the search process
  await searchJobs(jobQuery, numPages);
}

// Function to search for jobs and extract data
async function searchJobs(keyword, numPages = 3) {
  console.log(`Searching for jobs with keyword: ${keyword}`);
  
  const browser = await puppeteer.launch({ 
    headless: false, // Set to true for production
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null // Full size viewport
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');
    
    // Navigate to the search page
    console.log('Navigating to jobs.nvoids.com...');
    await page.goto('https://jobs.nvoids.com/search.jsp', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Optional: Take a screenshot for debugging
    await page.screenshot({ path: 'site-screenshot.png' });
    console.log('Screenshot saved to site-screenshot.png');
    
    // Based on the screenshot, we can now use the correct selectors
    // Fill in the search form with the exact input element we see
    console.log(`Entering search term: ${keyword}`);
    
    // Wait for the input field to be available
    await page.waitForSelector('input[name="mechanical engineer"]', { timeout: 5000 })
      .catch(async () => {
        // If we can't find that specific input, try a more generic selector
        console.log('Trying to find the search input field...');
        await page.waitForSelector('input[type="text"]', { timeout: 5000 });
      });
    
    // Type into the first text input field on the page
    const inputField = await page.$('input[type="text"]');
    if (inputField) {
      await inputField.click({ clickCount: 3 }); // Select all text
      await inputField.type(keyword);
    } else {
      console.error('Could not find the search input field');
      return [];
    }
    
    // Click the submit button
    console.log('Submitting search...');
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 })
        .catch(() => console.log('No navigation occurred after submit - continuing anyway'))
    ]);
    
    // Wait a moment for the results to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    let allJobs = [];
    let pageCount = 1;
    
    // Process the current page of results
    while (pageCount <= numPages) {
      console.log(`Processing page ${pageCount} of results...`);
      
      // Extract job data from the table
      const jobsOnPage = await extractJobsFromTable(page);
      console.log(`Found ${jobsOnPage.length} jobs on page ${pageCount}`);
      
      // Add jobs from this page to our collection
      allJobs = [...allJobs, ...jobsOnPage];
      
      // Check if there's a "Next" link to get to the next page
      const hasNextPage = await page.evaluate(() => {
        const nextLinks = Array.from(document.querySelectorAll('a')).filter(a => 
          a.textContent.trim().includes('Next')
        );
        return nextLinks.length > 0;
      });
      
      if (!hasNextPage || pageCount >= numPages) {
        break;
      }
      
      // Click the "Next" link and wait for the next page to load
      console.log('Navigating to the next page...');
      const navigated = await Promise.all([
        page.click('a:contains("Next")'),
        page.waitForNavigation({ waitUntil: 'networkidle2' })
      ]).then(() => true).catch(e => {
        console.log('Error navigating to next page:', e.message);
        return false;
      });
      
      if (!navigated) {
        break;
      }
      
      pageCount++;
    }
    
    console.log(`Total jobs found: ${allJobs.length}`);
    
    // Save the results to Excel file
    const fileName = `${keyword.replace(/\s+/g, '_')}_jobs.xlsx`;
    await saveToExcel(allJobs, fileName);
    console.log(`Results saved to ${fileName}`);
    
    // Also save JSON as backup
    const jsonFileName = `${keyword.replace(/\s+/g, '_')}_jobs.json`;
    fs.writeFileSync(jsonFileName, JSON.stringify(allJobs, null, 2));
    console.log(`JSON backup saved to ${jsonFileName}`);
    
    return allJobs;
    
  } catch (error) {
    console.error('An error occurred:', error);
    return [];
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

// Function to extract job data from the table structure we see in the screenshot
async function extractJobsFromTable(page) {
  return await page.evaluate(() => {
    const jobs = [];
    
    // Look for all table rows that might contain job listings
    // Skip the header row by starting from index 1
    const rows = document.querySelectorAll('table tr');
    
    // Process each row to extract job information
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.querySelectorAll('td');
      
      // Skip rows that don't have enough cells
      if (cells.length < 3) continue;
      
      // Extract job information from the cells
      const titleCell = cells[0];
      const locationCell = cells[1];
      const dateCell = cells[2];
      
      // Get the job title and link
      const titleLink = titleCell.querySelector('a');
      const title = titleLink ? titleLink.textContent.trim() : 'No Title';
      const link = titleLink ? titleLink.href : '';
      
      // Get the location
      const location = locationCell ? locationCell.textContent.trim() : 'No Location';
      
      // Get the date posted
      const datePosted = dateCell ? dateCell.textContent.trim() : 'No Date';
      
      // Add the job to our list
      jobs.push({
        title,
        link,
        location,
        datePosted,
        // We don't have company or description in the table, leaving as N/A
        company: 'N/A',
        description: 'N/A'
      });
    }
    
    return jobs;
  });
}

// Function to save job data to Excel file
async function saveToExcel(jobs, filePath) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Job Listings');

  // Add headers
  worksheet.columns = [
    { header: 'Job Title', key: 'title', width: 40 },
    { header: 'Company', key: 'company', width: 30 },
    { header: 'Location', key: 'location', width: 30 },
    { header: 'Date Posted', key: 'datePosted', width: 20 },
    { header: 'Description', key: 'description', width: 50 },
    { header: 'Link', key: 'link', width: 50 }
  ];

  // Style the header row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' } // Light gray background
  };

  // Add job data
  jobs.forEach(job => {
    worksheet.addRow({
      title: job.title || 'N/A',
      company: job.company || 'N/A',
      location: job.location || 'N/A',
      datePosted: job.datePosted || 'N/A',
      description: job.description || 'N/A',
      link: job.link || 'N/A'
    });
  });

  // Auto-filter the header row
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 6 }
  };

  // Set hyperlinks for job URLs
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) { // Skip header row
      const cell = row.getCell('link');
      if (cell.value && cell.value !== 'N/A') {
        cell.value = {
          text: 'View Job',
          hyperlink: cell.value
        };
        cell.font = {
          color: { argb: 'FF0000FF' }, // Blue color
          underline: true
        };
      }
    }
  });

  // Save the workbook
  await workbook.xlsx.writeFile(filePath);
}

// Run the main function
main();