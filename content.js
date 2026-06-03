// Content script for extracting job description from supported job sites

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'grab_jd') {
    const jobDescription = extractJobDescription();
    if (jobDescription) {
      sendResponse({ jd: jobDescription });
    } else {
      sendResponse({ jd: '' });
    }
    // Return true to indicate we will respond asynchronously
    return true;
  }
});

// Function to extract job description from the page
function extractJobDescription() {
  // Common selectors for job description on various sites
  const selectors = [
    // LinkedIn
    '.jobs-description__content',
    '.jobs-box__html-content',
    // Internshala
    '.internship_details_container',
    '.individual_internship_details',
    // Wellfound (AngelList)
    '.job-description',
    '.description',
    // Naukri
    '.jd-description',
    '.job-description',
    // Indeed
    '.jobsearch-jobDescriptionText',
    // Glassdoor
    '.jobDescriptionContent',
    // Cutshort
    '.job-description-section',
    // Generic fallbacks
    'article',
    '.description',
    '[data-job-description]',
    '.job-details'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      // Clean up the text: remove extra whitespace, etc.
      let text = element.innerText || element.textContent;
      if (text) {
        // Limit to a reasonable length (e.g., 5000 characters) to avoid too long prompts
        return text.trim().substring(0, 5000);
      }
    }
  }

  // If no specific selector works, try to get the main content
  const main = document.querySelector('main');
  if (main) {
    let text = main.innerText || main.textContent;
    if (text) {
      return text.trim().substring(0, 5000);
    }
  }

  // Last resort: get body text and hope for the best
  const body = document.body;
  if (body) {
    let text = body.innerText || body.textContent;
    if (text) {
      // Try to extract a reasonable portion by looking for lines that might be JD
      // But for simplicity, we return the first 5000 chars
      return text.trim().substring(0, 5000);
    }
  }

  return '';
}