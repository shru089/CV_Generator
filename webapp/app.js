// ── State Management ────────────────────────────────────────────────
let selectedOutputType = 'both';
let parsedBaseResumeText = '';
let currentFile = null;

// Detect Chrome Extension context for shared settings storage
const isExtensionContext = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

// ── Tab Switching (App Header) ──────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    document.querySelectorAll('.tab-pane').forEach(tab => tab.classList.remove('active'));
    const tabId = 'tab-' + btn.dataset.tab;
    const targetTab = document.getElementById(tabId);
    if (targetTab) {
      targetTab.classList.add('active');
    }
    
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'settings') loadSettings();
  });
});

// ── Result Sub-Tabs ─────────────────────────────────────────────────
document.querySelectorAll('.result-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.result-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    document.querySelectorAll('.result-tab-pane').forEach(c => c.classList.remove('active'));
    const targetId = 'rtab-' + btn.dataset.rtab;
    const targetPane = document.getElementById(targetId);
    if (targetPane) {
      targetPane.classList.add('active');
    }
  });
});

// ── Setup Dropzone and File Selectors ────────────────────────────────
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileStatus = document.getElementById('file-status');
const fileStatusName = document.getElementById('file-status-name');
const fileStatusSize = document.getElementById('file-status-size');
const fileRemoveBtn = document.getElementById('file-remove-btn');
const baseResumeTextArea = document.getElementById('base-resume-text');

// Click to browse files
dropzone.addEventListener('click', () => {
  fileInput.click();
});

// Drag over/leave highlighting
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

// File Dropped
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    await handleUploadedFile(files[0]);
  }
});

// File Selected via dialog
fileInput.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (files.length > 0) {
    await handleUploadedFile(files[0]);
  }
});

// Remove loaded file
fileRemoveBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  currentFile = null;
  parsedBaseResumeText = '';
  fileInput.value = '';
  baseResumeTextArea.value = '';
  fileStatus.classList.add('hidden');
  if (isExtensionContext) {
    await chrome.storage.local.remove(['baseResume', 'loadedFileName']);
  } else {
    localStorage.removeItem('resumeTailorParsedBaseResume');
    localStorage.removeItem('resumeTailorLoadedFileName');
  }
});

// ── File Parsing Core ────────────────────────────────────────────────
async function handleUploadedFile(file) {
  currentFile = file;
  fileStatusName.textContent = file.name;
  
  // Format file size
  const kb = (file.size / 1024).toFixed(1);
  fileStatusSize.textContent = `(${kb} KB)`;
  
  // Show file status loader
  fileStatus.classList.remove('hidden');
  
  try {
    const text = await parseResumeFile(file);
    parsedBaseResumeText = text;
    baseResumeTextArea.value = text;
    // Save state
    if (isExtensionContext) {
      await chrome.storage.local.set({ baseResume: text, loadedFileName: file.name });
    } else {
      localStorage.setItem('resumeTailorParsedBaseResume', text);
      localStorage.setItem('resumeTailorLoadedFileName', file.name);
    }
    document.getElementById('no-resume-warning').classList.add('hidden');
  } catch (err) {
    alert('File parsing failed: ' + err.message);
    fileRemoveBtn.click();
  }
}

async function parseResumeFile(file) {
  const name = file.name.toLowerCase();
  const arrayBuffer = await file.arrayBuffer();
  
  if (name.endsWith('.pdf')) {
    return await parsePDF(arrayBuffer);
  } else if (name.endsWith('.docx')) {
    return await parseDOCX(arrayBuffer);
  } else if (name.endsWith('.doc')) {
    return parseDOC(arrayBuffer);
  } else if (name.endsWith('.txt')) {
    return parseTXT(arrayBuffer);
  } else {
    throw new Error('Unsupported format. Please upload a .txt, .doc, .docx, or .pdf file.');
  }
}

// 1. PDF Parser via Local pdf.js
async function parsePDF(arrayBuffer) {
  // Set worker source path locally
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

// 2. DOCX Parser via Local mammoth.js
async function parseDOCX(arrayBuffer) {
  return new Promise((resolve, reject) => {
    mammoth.extractRawText({ arrayBuffer: arrayBuffer })
      .then(result => resolve(result.value))
      .catch(err => reject(err));
  });
}

// 3. Custom Byte-Level DOC (Word 97-2003) Scraper
function parseDOC(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const len = view.byteLength;
  let text = '';
  
  // Scan for Unicode UTF-16LE characters (Word 97+ structure)
  let i = 0;
  let tempText = [];
  while (i < len - 1) {
    const b1 = view.getUint8(i);
    const b2 = view.getUint8(i + 1);
    if (b2 === 0 && ((b1 >= 32 && b1 <= 126) || b1 === 10 || b1 === 13 || b1 === 9)) {
      tempText.push(String.fromCharCode(b1));
      i += 2;
    } else {
      if (tempText.length >= 6) {
        text += tempText.join('') + ' ';
      }
      tempText = [];
      i += 2;
    }
  }
  if (tempText.length >= 6) {
    text += tempText.join('');
  }
  
  // Fall back to ASCII scanning if Unicode yields insufficient character count
  if (text.trim().length < 50) {
    text = '';
    let asciiTemp = [];
    for (let j = 0; j < len; j++) {
      const b = view.getUint8(j);
      if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
        asciiTemp.push(String.fromCharCode(b));
      } else {
        if (asciiTemp.length >= 6) {
          text += asciiTemp.join('') + ' ';
        }
        asciiTemp = [];
      }
    }
    if (asciiTemp.length >= 6) {
      text += asciiTemp.join('');
    }
  }
  
  // Clean up binary scrap characters
  text = text
    .replace(/[^\x20-\x7E\n\t]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/[\r\n]+/g, '\n')
    .trim();
    
  return text;
}

// 4. Plain Text Parser
function parseTXT(arrayBuffer) {
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(arrayBuffer);
}

// ── Main Tailor Action ───────────────────────────────────────────────
document.getElementById('tailor-btn').addEventListener('click', async () => {
  const jd = document.getElementById('jd-input').value.trim();
  if (!jd) { alert('Please paste a job description first.'); return; }
  
  // Synchronize manual text edits from the details panel
  const manualText = baseResumeTextArea.value.trim();
  if (manualText) {
    parsedBaseResumeText = manualText;
  }
  
  const { geminiApiKey } = await getSettings();
  if (!parsedBaseResumeText) {
    document.getElementById('no-resume-warning').classList.remove('hidden');
    return;
  }
  if (!geminiApiKey) {
    alert('Please enter your Google Gemini API key in Settings.');
    document.querySelector('.nav-tab[data-tab="settings"]').click();
    return;
  }
  document.getElementById('no-resume-warning').classList.add('hidden');
  
  const btn = document.getElementById('tailor-btn');
  const loading = document.getElementById('loading');
  const resultsContainer = document.getElementById('results-container');
  const placeholder = document.getElementById('results-placeholder');
  
  btn.disabled = true;
  loading.classList.remove('hidden');
  resultsContainer.classList.add('hidden');
  placeholder.classList.add('hidden');
  
  const tone = document.getElementById('tone-select').value;
  selectedOutputType = document.getElementById('output-type-select').value;
  
  try {
    const result = await callGeminiDirect(parsedBaseResumeText, jd, selectedOutputType, tone, geminiApiKey);
    displayResult(result, jd);
    saveToHistory(jd, result);
  } catch (err) {
    let msg = err.message;
    if (msg.includes('Failed to fetch')) {
      msg = "Failed to fetch. If you opened the web app directly via file:///, please open it through the Chrome Extension instead (by clicking the settings gear icon in the pop-up) to permit outbound API calls, or run a local web server (e.g., http://localhost:5173).";
    }
    alert('Error during tailoring: ' + msg);
    placeholder.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    loading.classList.add('hidden');
  }
});

// ── Get Best Model dynamically ─────────────────────────────────────
async function getBestModel(apiKey) {
  const endpoints = ['v1beta', 'v1'];
  for (const apiVer of endpoints) {
    try {
      const url = `https://generativelanguage.googleapis.com/${apiVer}/models?key=${apiKey}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const models = data.models || [];
        const generateModels = models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace('models/', ''));
        
        const preferredModels = [
          'gemini-2.5-flash',
          'gemini-2.0-flash',
          'gemini-1.5-flash',
          'gemini-2.5-pro',
          'gemini-2.0-pro',
          'gemini-1.5-pro'
        ];
        
        for (const pref of preferredModels) {
          if (generateModels.includes(pref)) {
            return { model: pref, apiVersion: apiVer };
          }
        }
        
        if (generateModels.length > 0) {
          return { model: generateModels[0], apiVersion: apiVer };
        }
      }
    } catch (e) {
      // ignore
    }
  }
  return { model: 'gemini-1.5-flash', apiVersion: 'v1beta' };
}

// ── Call Gemini directly ──────────────────────────────────────────
async function callGeminiDirect(resume, jd, outputType, tone, apiKey) {
  const outputTypeMap = {
    both: 'a fully tailored resume based on the candidate\'s uploaded resume (optimizing Professional Summary, Experience bullet points, Projects, and Skills sections specifically for the job description while preserving contact details, education, and structural integrity of the candidate\'s uploaded resume) followed by a compelling cover letter (3-4 paragraphs) addressed to the hiring manager, separated by a clear divider line: "==================== COVER LETTER ===================="',
    resume: 'a fully tailored resume based on the candidate\'s uploaded resume, re-writing and optimizing the Summary/Objective, Experience bullet points, Projects, and Skills sections specifically for the job description to match keywords naturally for ATS, while preserving original contact details, education, and general layout structure',
    cover: 'a compelling, tailored cover letter (3-4 paragraphs) addressed to the hiring manager for this specific job position, matching the job requirements to the candidate\'s achievements',
    bullets: '6-8 highly tailored, results-oriented, ATS-friendly bullet points for the resume experience section, starting with strong action verbs (e.g. Led, Designed, Optimized) and incorporating metrics/outcomes'
  };
  
  const toneMap = {
    confident: 'confident, direct, results-oriented',
    enthusiastic: 'enthusiastic, energetic, passionate',
    formal: 'formal, professional, polished',
    concise: 'concise, minimal, sharp'
  };
  
  const prompt = `You are an expert resume coach. Tailor this candidate's resume/CV for the job posting below.

CANDIDATE RESUME:
${resume}

JOB DESCRIPTION:
${jd}

Generate: ${outputTypeMap[outputType]}
Tone: ${toneMap[tone]}

Rules:
- Ensure the tailored resume starts directly with the candidate's name or contact info, or a clear section heading. Do NOT include any conversational filler, introductory remarks, or explanations (e.g., do NOT start with "Here is your tailored resume...", "Sure, I can help...", "Sure, here's...").
- Do NOT output any preamble, postamble, or conversational notes. Only output the requested tailored document text.
- Standardize the tailored resume sections using clean markdown headings:
  # [Candidate Name]
  [Contact Info Line]
  
  ## PROFESSIONAL SUMMARY
  [Paragraph]
  
  ## EXPERIENCE
  ### [Job Title] | [Company] | [Date Range]
  - [Bullet point 1]
  - [Bullet point 2]
  
  ## PROJECTS
  ### [Project Name] | [Date Range]
  - [Bullet point 1]
  
  ## EDUCATION
  ### [Degree] | [School] | [Date Range]
  
  ## SKILLS
  - [Skill 1], [Skill 2]...
- Only use skills/projects the candidate ACTUALLY HAS.
- Match JD keywords naturally for ATS.
- Be specific with project names and outcomes.
- Flag if this role is not a good match.

After the main output, append these metadata sections strictly:
---MATCH_SCORE---
[number 1-10 only]
---ATS_STATUS---
[PASS or WARN]
---GAPS---
[2-3 honest gaps or things to address]
---STRENGTHS---
[Top 3 matching strengths, one per line]`;

  const settings = await getSettings();
  let model = settings.geminiModel;
  let apiVer = settings.geminiApiVersion;
  
  if (!model || !apiVer) {
    const best = await getBestModel(apiKey);
    model = best.model;
    apiVer = best.apiVersion;
    
    if (isExtensionContext) {
      await chrome.storage.local.set({ geminiModel: model, geminiApiVersion: apiVer });
    } else {
      localStorage.setItem('resumeTailorGeminiModel', model);
      localStorage.setItem('resumeTailorGeminiApiVersion', apiVer);
    }
  }

  const makeRequest = async (m, v) => {
    const url = `https://generativelanguage.googleapis.com/${v}/models/${m}:generateContent?key=${apiKey}`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.2
        }
      })
    });
  };

  let resp = await makeRequest(model, apiVer);
  
  if (!resp.ok) {
    // Self-healing fallback: query available models and retry
    const best = await getBestModel(apiKey);
    model = best.model;
    apiVer = best.apiVersion;
    
    if (isExtensionContext) {
      await chrome.storage.local.set({ geminiModel: model, geminiApiVersion: apiVer });
    } else {
      localStorage.setItem('resumeTailorGeminiModel', model);
      localStorage.setItem('resumeTailorGeminiApiVersion', apiVer);
    }
    
    resp = await makeRequest(model, apiVer);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API call returned status ${resp.status}`);
    }
  }
  
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseResponse(text);
}

function parseResponse(text) {
  const scoreMatch = text.match(/---MATCH_SCORE---\s*(\d+)/);
  const atsMatch = text.match(/---ATS_STATUS---\s*(PASS|WARN)/);
  const gapsMatch = text.match(/---GAPS---\s*([\s\S]*?)(?=---|$)/);
  const strengthsMatch = text.match(/---STRENGTHS---\s*([\s\S]*?)(?=---|$)/);
  
  const mainOutput = text
    .replace(/---MATCH_SCORE---[\s\S]*?(?=---|$)/g, '')
    .replace(/---ATS_STATUS---[\s\S]*?(?=---|$)/g, '')
    .replace(/---GAPS---[\s\S]*?(?=---|$)/g, '')
    .replace(/---STRENGTHS---[\s\S]*/g, '')
    .trim();
    
  return {
    output: mainOutput,
    score: scoreMatch ? parseInt(scoreMatch[1]) : 7,
    ats: atsMatch ? atsMatch[1] : 'WARN',
    gaps: gapsMatch ? gapsMatch[1].trim() : 'Review keywords alignment.',
    strengths: strengthsMatch ? strengthsMatch[1].trim() : 'Matches core technical specifications.'
  };
}

// ── Display Results ──────────────────────────────────────────────────
function displayResult({ output, score, ats, gaps, strengths }, jd) {
  document.getElementById('output-text').textContent = output;
  document.getElementById('gaps-text').textContent = `GAPS TO ADDRESS:\n${gaps}\n\nKEY STRENGTHS:\n${strengths}`;
  
  // Set Match Score Circle Animation
  const scoreRing = document.getElementById('score-ring');
  const scoreVal = document.getElementById('score-val');
  scoreVal.textContent = score;
  
  // SVG Stroke animation offset
  // Circumference is 2 * pi * 40 = ~251.2
  const offset = 251.2 - (score / 10) * 251.2;
  scoreRing.style.strokeDashoffset = offset;
  
  // Update status badges
  const atsBadge = document.getElementById('ats-badge');
  const matchLabel = document.getElementById('match-label');
  
  if (ats === 'PASS') {
    atsBadge.textContent = '✓ ATS FRIENDLY';
    atsBadge.className = 'ats-status-badge pass';
  } else {
    atsBadge.textContent = '⚠ ATS REWORK';
    atsBadge.className = 'ats-status-badge warn';
  }
  
  const matchLevel = score >= 8 ? 'Strong Match' : score >= 6 ? 'Decent Match' : 'Weak Match';
  matchLabel.textContent = matchLevel;
  
  // Generate Keyword density cloud
  generateKeywordCloud(jd, output);
  
  // Show active display pane
  document.getElementById('results-placeholder').classList.add('hidden');
  document.getElementById('results-container').classList.remove('hidden');
}

// ── Keyword Analyzer Cloud Generator ───────────────────────────────
function generateKeywordCloud(jd, output) {
  const container = document.getElementById('keyword-cloud');
  container.innerHTML = '';
  
  const stopWords = new Set([
    'the', 'of', 'in', 'and', 'to', 'a', 'is', 'for', 'on', 'with', 'as', 'by', 'an', 'at', 'or', 'are', 'from',
    'this', 'that', 'it', 'be', 'an', 'your', 'our', 'their', 'we', 'you', 'i', 'me', 'us', 'can', 'will', 'should',
    'would', 'could', 'must', 'has', 'have', 'had', 'been', 'was', 'were', 'do', 'does', 'did', 'about', 'above',
    'across', 'after', 'against', 'along', 'among', 'around', 'before', 'behind', 'below', 'beneath', 'beside',
    'between', 'beyond', 'during', 'except', 'into', 'like', 'near', 'off', 'through', 'toward', 'under', 'until',
    'up', 'upon', 'within', 'without', 'roles', 'responsibilities', 'experience', 'skills', 'requirements',
    'candidate', 'team', 'work', 'working', 'ability', 'years', 'strong', 'good', 'excellent', 'must', 'have',
    'required', 'preferred', 'highly', 'successful', 'development', 'management', 'project', 'business'
  ]);
  
  // Capture typical technical keywords like .net, react-native, C++, Node.js, etc.
  const words = jd.toLowerCase().match(/[a-z0-9+#.-]{2,}/g) || [];
  
  const freq = {};
  for (const word of words) {
    if (!stopWords.has(word) && !/^\d+$/.test(word)) {
      freq[word] = (freq[word] || 0) + 1;
    }
  }
  
  // Sort and select top 12 keywords
  const sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
  const keywords = sorted.slice(0, 12);
  
  const outputLower = output.toLowerCase();
  
  keywords.forEach(keyword => {
    const isMatched = outputLower.includes(keyword);
    const badge = document.createElement('span');
    badge.className = `kw-badge ${isMatched ? 'matched' : 'missing'}`;
    badge.textContent = (isMatched ? '✓ ' : '+ ') + keyword;
    badge.title = isMatched ? `Matched in CV` : `Missing keyword! Try adding this term to your CV.`;
    container.appendChild(badge);
  });
}

// ── Copy to Clipboard ────────────────────────────────────────────────
document.getElementById('copy-btn').addEventListener('click', () => {
  const text = document.getElementById('output-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '⎘ Copy Text'; }, 2000);
  });
});

// ── Exporter: Word .docx Generator (Local docx.js) ──────────────────
document.getElementById('docx-btn').addEventListener('click', () => {
  const text = document.getElementById('output-text').textContent;
  if (!text) { alert('No content to download.'); return; }
  
  try {
    const { Document, Paragraph, TextRun, Packer, HeadingLevel } = window.docx;
    const lines = text.split('\n');
    const docChildren = [];
    
    // Style Word document professionally
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        docChildren.push(new Paragraph({ text: "" }));
        continue;
      }
      
      // Determine if heading
      const isHeading = trimmed === trimmed.toUpperCase() && trimmed.length < 45 && !trimmed.endsWith('.') && trimmed.length > 2;
      
      if (isHeading) {
        docChildren.push(new Paragraph({
          text: trimmed,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
          keepWithNext: true
        }));
      } else {
        const isBullet = trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*');
        const cleanText = isBullet ? trimmed.substring(1).trim() : trimmed;
        
        docChildren.push(new Paragraph({
          children: [
            new TextRun({
              text: cleanText,
              size: 22, // 11pt
              font: "Arial"
            })
          ],
          bullet: isBullet ? { level: 0 } : undefined,
          spacing: { before: 60, after: 60 }
        }));
      }
    }
    
    const doc = new Document({
      sections: [{
        properties: {},
        children: docChildren
      }]
    });
    
    Packer.toBlob(doc).then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tailored-resume.docx';
      a.click();
      window.URL.revokeObjectURL(url);
    });
  } catch (err) {
    console.error('Word Document generation failed:', err);
    alert('Word Document generation failed. Please try again.');
  }
});

// ── Helper: Hex to RGB ──────────────────────────────────────────────
function hexToRgb(hex) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 136, g: 121, b: 252 };
}

// ── Helper: Parse Markdown Resume ───────────────────────────────────
function parseResumeMarkdown(text) {
  const lines = text.split('\n');
  const result = {
    name: '',
    contact: '',
    summary: '',
    experience: [],
    projects: [],
    education: [],
    skills: []
  };
  
  let currentSection = '';
  let currentItem = null;
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('# ')) {
      result.name = trimmed.replace('# ', '').trim();
      continue;
    }
    
    if (trimmed.startsWith('## ')) {
      const secName = trimmed.replace('## ', '').toUpperCase().trim();
      if (secName.includes('SUMMARY') || secName.includes('OBJECTIVE') || secName.includes('PROFILE')) {
        currentSection = 'summary';
      } else if (secName.includes('EXPERIENCE') || secName.includes('WORK')) {
        currentSection = 'experience';
      } else if (secName.includes('PROJECT')) {
        currentSection = 'projects';
      } else if (secName.includes('EDUCATION')) {
        currentSection = 'education';
      } else if (secName.includes('SKILL')) {
        currentSection = 'skills';
      } else {
        currentSection = 'other';
      }
      continue;
    }
    
    if (trimmed.startsWith('### ')) {
      const sub = trimmed.replace('### ', '').trim();
      currentItem = { title: sub, bullets: [] };
      if (currentSection === 'experience') {
        result.experience.push(currentItem);
      } else if (currentSection === 'projects') {
        result.projects.push(currentItem);
      } else if (currentSection === 'education') {
        result.education.push(currentItem);
      }
      continue;
    }
    
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
      const bulletText = trimmed.replace(/^[-•*]\s*/, '').trim();
      if (currentItem && (currentSection === 'experience' || currentSection === 'projects' || currentSection === 'education')) {
        currentItem.bullets.push(bulletText);
      } else if (currentSection === 'skills') {
        result.skills.push(bulletText);
      }
      continue;
    }
    
    if (currentSection === 'summary') {
      result.summary = (result.summary ? result.summary + '\n' : '') + trimmed;
    } else if (result.name && !currentSection && !trimmed.startsWith('=')) {
      result.contact = (result.contact ? result.contact + ' | ' : '') + trimmed;
    } else if (currentSection === 'skills') {
      result.skills.push(trimmed);
    }
  }
  
  return result;
}

// ── Exporter: Enhanced PDF Generator (Local jsPDF) ──────────────────
document.getElementById('pdf-btn').addEventListener('click', async () => {
  const text = document.getElementById('output-text').textContent;
  if (!text) { alert('No content to download.'); return; }
  
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    const settings = await getSettings();
    const layout = settings.templateLayout || 'modern';
    const font = settings.templateFont || 'sans';
    const colorHex = settings.templateColor || '#8879fc';
    
    const rgb = hexToRgb(colorHex);
    const fontMap = {
      sans: 'Helvetica',
      serif: 'Times',
      monospace: 'Courier'
    };
    const fontName = fontMap[font] || 'Helvetica';
    
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxW = pageW - (2 * margin);
    
    let resumeText = text;
    let coverText = '';
    
    // Check if the output is cover letter only
    let isCoverLetterOnly = false;
    if (text.includes('COVER LETTER') || text.includes('=== COVER LETTER ===') || text.includes('==================== COVER LETTER ====================')) {
      const parts = text.split(/={3,}.*COVER LETTER.*={3,}/i);
      if (parts.length > 1) {
        resumeText = parts[0].trim();
        coverText = parts[1].trim();
      } else {
        isCoverLetterOnly = !text.includes('## EXPERIENCE') && !text.includes('## WORK');
      }
    } else {
      isCoverLetterOnly = !text.includes('## EXPERIENCE') && !text.includes('## WORK') && !text.includes('## PROFESSIONAL SUMMARY');
    }
    
    if (isCoverLetterOnly) {
      coverText = text.trim();
      resumeText = '';
    }
    
    // Parse name and contact from base resume if this is cover letter only
    const baseInfo = parseResumeMarkdown(parsedBaseResumeText || '');
    const resume = resumeText ? parseResumeMarkdown(resumeText) : {
      name: baseInfo.name || 'Candidate Name',
      contact: baseInfo.contact || '',
      summary: '',
      experience: [],
      projects: [],
      education: [],
      skills: []
    };
    
    let y = margin;
    
    // Helper to verify y-bounds and add pages
    const checkNewPage = (heightNeeded) => {
      if (y + heightNeeded > pageH - margin) {
        doc.addPage();
        y = margin;
        return true;
      }
      return false;
    };
    
    if (resumeText) {
      if (layout === 'split') {
      // ── CREATIVE 2-COLUMN SPLIT TEMPLATE ────────────────────────────
      const sidebarW = 68; // mm
      doc.setFillColor(243, 242, 248);
      doc.rect(0, 0, sidebarW, pageH, 'F');
      
      doc.setDrawColor(220, 218, 235);
      doc.line(sidebarW, 0, sidebarW, pageH);
      
      let leftY = 20;
      
      // Name
      doc.setFont(fontName, 'bold');
      doc.setFontSize(18);
      doc.setTextColor(rgb.r, rgb.g, rgb.b);
      const nameLines = doc.splitTextToSize(resume.name || 'Candidate Name', sidebarW - 10);
      doc.text(nameLines, 8, leftY);
      leftY += (nameLines.length * 6.5) + 3;
      
      // Contact Info
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 95);
      if (resume.contact) {
        const contactParts = resume.contact.split('|').map(p => p.trim());
        for (const part of contactParts) {
          const partLines = doc.splitTextToSize(part, sidebarW - 12);
          doc.text(partLines, 8, leftY);
          leftY += (partLines.length * 3.8) + 1.5;
        }
      }
      leftY += 6;
      
      // Skills Section
      if (resume.skills.length > 0) {
        doc.setFont(fontName, 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('KEY SKILLS', 8, leftY);
        leftY += 5;
        
        doc.setFont(fontName, 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(45, 45, 55);
        
        for (const skill of resume.skills) {
          const cleanSkill = skill.replace(/^[•\s\-\*]+/, '');
          const skillLines = doc.splitTextToSize('• ' + cleanSkill, sidebarW - 12);
          doc.text(skillLines, 8, leftY);
          leftY += (skillLines.length * 4.2);
        }
        leftY += 8;
      }
      
      // Education Section
      if (resume.education.length > 0) {
        doc.setFont(fontName, 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('EDUCATION', 8, leftY);
        leftY += 5;
        
        for (const edu of resume.education) {
          doc.setFont(fontName, 'bold');
          doc.setFontSize(9);
          doc.setTextColor(45, 45, 55);
          const titleLines = doc.splitTextToSize(edu.title, sidebarW - 12);
          doc.text(titleLines, 8, leftY);
          leftY += (titleLines.length * 4.2);
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(8);
          doc.setTextColor(90, 90, 105);
          for (const bullet of edu.bullets) {
            const bulletLines = doc.splitTextToSize(bullet, sidebarW - 12);
            doc.text(bulletLines, 8, leftY);
            leftY += (bulletLines.length * 3.6) + 1;
          }
          leftY += 3;
        }
      }
      
      // RIGHT MAIN COLUMN
      let rightY = 20;
      const rightX = sidebarW + 8;
      const rightW = pageW - rightX - 8;
      
      // Professional Summary
      if (resume.summary) {
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('PROFESSIONAL SUMMARY', rightX, rightY);
        rightY += 5;
        
        doc.setFont(fontName, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(45, 45, 55);
        const summaryLines = doc.splitTextToSize(resume.summary, rightW);
        doc.text(summaryLines, rightX, rightY);
        rightY += (summaryLines.length * 4.5) + 8;
      }
      
      // Experience Section
      if (resume.experience.length > 0) {
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('WORK EXPERIENCE', rightX, rightY);
        rightY += 5;
        
        for (const exp of resume.experience) {
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 30, 40);
          const expTitleLines = doc.splitTextToSize(exp.title, rightW);
          doc.text(expTitleLines, rightX, rightY);
          rightY += (expTitleLines.length * 4.5) + 2;
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(55, 55, 65);
          for (const bullet of exp.bullets) {
            const bulletLines = doc.splitTextToSize('• ' + bullet, rightW);
            doc.text(bulletLines, rightX, rightY);
            rightY += (bulletLines.length * 4);
          }
          rightY += 4;
        }
        rightY += 4;
      }
      
      // Projects Section
      if (resume.projects.length > 0) {
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('PROJECTS & ACHIEVEMENTS', rightX, rightY);
        rightY += 5;
        
        for (const proj of resume.projects) {
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 30, 40);
          const titleLines = doc.splitTextToSize(proj.title, rightW);
          doc.text(titleLines, rightX, rightY);
          rightY += (titleLines.length * 4.5) + 2;
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(55, 55, 65);
          for (const bullet of proj.bullets) {
            const bulletLines = doc.splitTextToSize('• ' + bullet, rightW);
            doc.text(bulletLines, rightX, rightY);
            rightY += (bulletLines.length * 4);
          }
          rightY += 4;
        }
      }
      
    } else if (layout === 'classic') {
      // ── CLASSIC PROFESSIONAL TEMPLATE (Centered) ───────────────────
      doc.setFont(fontName, 'bold');
      doc.setFontSize(20);
      doc.setTextColor(30, 30, 35);
      doc.text(resume.name || 'Candidate Name', pageW / 2, y, { align: 'center' });
      y += 6;
      
      doc.setFont(fontName, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 90);
      if (resume.contact) {
        doc.text(resume.contact, pageW / 2, y, { align: 'center' });
        y += 5;
      }
      
      // Divider line
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageW - margin, y);
      y += 6;
      
      // Professional Summary
      if (resume.summary) {
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('PROFESSIONAL SUMMARY', margin, y);
        y += 4;
        
        doc.setFont(fontName, 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(50, 50, 55);
        const summaryLines = doc.splitTextToSize(resume.summary, maxW);
        doc.text(summaryLines, margin, y);
        y += (summaryLines.length * 4.5) + 6;
      }
      
      // Experience
      if (resume.experience.length > 0) {
        checkNewPage(20);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('WORK EXPERIENCE', margin, y);
        y += 2;
        doc.line(margin, y, pageW - margin, y);
        y += 4;
        
        for (const exp of resume.experience) {
          const titleLines = doc.splitTextToSize(exp.title, maxW);
          checkNewPage(titleLines.length * 4.5 + 4);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(35, 35, 40);
          doc.text(titleLines, margin, y);
          y += (titleLines.length * 4.5) + 1.5;
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 65);
          for (const bullet of exp.bullets) {
            const cleanBullet = bullet.replace(/^[•\-\*\s]+/, '');
            const bulletLines = doc.splitTextToSize(cleanBullet, maxW - 6);
            checkNewPage(bulletLines.length * 4.2);
            doc.text('•', margin + 2, y);
            doc.text(bulletLines, margin + 6, y);
            y += (bulletLines.length * 4.2);
          }
          y += 3;
        }
        y += 3;
      }
      
      // Projects
      if (resume.projects.length > 0) {
        checkNewPage(20);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('PROJECTS & KEY ACHIEVEMENTS', margin, y);
        y += 2;
        doc.line(margin, y, pageW - margin, y);
        y += 4;
        
        for (const proj of resume.projects) {
          const titleLines = doc.splitTextToSize(proj.title, maxW);
          checkNewPage(titleLines.length * 4.5 + 4);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(35, 35, 40);
          doc.text(titleLines, margin, y);
          y += (titleLines.length * 4.5) + 1.5;
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 65);
          for (const bullet of proj.bullets) {
            const cleanBullet = bullet.replace(/^[•\-\*\s]+/, '');
            const bulletLines = doc.splitTextToSize(cleanBullet, maxW - 6);
            checkNewPage(bulletLines.length * 4.2);
            doc.text('•', margin + 2, y);
            doc.text(bulletLines, margin + 6, y);
            y += (bulletLines.length * 4.2);
          }
          y += 3;
        }
        y += 3;
      }
      
      // Education
      if (resume.education.length > 0) {
        checkNewPage(20);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('EDUCATION', margin, y);
        y += 2;
        doc.line(margin, y, pageW - margin, y);
        y += 4;
        
        for (const edu of resume.education) {
          const titleLines = doc.splitTextToSize(edu.title, maxW);
          checkNewPage(titleLines.length * 4.5 + 4);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(35, 35, 40);
          doc.text(titleLines, margin, y);
          y += (titleLines.length * 4.5) + 1.5;
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(9);
          doc.setTextColor(70, 70, 75);
          for (const bullet of edu.bullets) {
            const bulletLines = doc.splitTextToSize(bullet, maxW - 6);
            checkNewPage(bulletLines.length * 4.2);
            doc.text(bulletLines, margin + 6, y);
            y += (bulletLines.length * 4.2) + 1;
          }
          y += 2;
        }
        y += 3;
      }
      
      // Skills
      if (resume.skills.length > 0) {
        checkNewPage(15);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('TECHNICAL SKILLS', margin, y);
        y += 2;
        doc.line(margin, y, pageW - margin, y);
        y += 4;
        
        doc.setFont(fontName, 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(50, 50, 55);
        const skillText = resume.skills.map(s => s.replace(/^[•\s\-\*]+/, '')).join(', ');
        const skillLines = doc.splitTextToSize(skillText, maxW);
        doc.text(skillLines, margin, y);
      }
      
    } else {
      // ── MODERN MINIMALIST TEMPLATE (Default) ────────────────────────
      doc.setFont(fontName, 'bold');
      doc.setFontSize(20);
      doc.setTextColor(rgb.r, rgb.g, rgb.b);
      doc.text(resume.name || 'Candidate Name', margin, y);
      y += 5.5;
      
      doc.setFont(fontName, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 120);
      if (resume.contact) {
        doc.text(resume.contact, margin, y);
        y += 4.5;
      }
      
      // Divider line
      doc.setDrawColor(rgb.r, rgb.g, rgb.b);
      doc.setLineWidth(0.6);
      doc.line(margin, y, pageW - margin, y);
      y += 6;
      
      // Professional Summary
      if (resume.summary) {
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('PROFESSIONAL SUMMARY', margin, y);
        y += 5;
        
        doc.setFont(fontName, 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(50, 50, 55);
        const summaryLines = doc.splitTextToSize(resume.summary, maxW);
        doc.text(summaryLines, margin, y);
        y += (summaryLines.length * 4.5) + 6;
      }
      
      // Experience
      if (resume.experience.length > 0) {
        checkNewPage(18);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('WORK EXPERIENCE', margin, y);
        y += 5;
        
        for (const exp of resume.experience) {
          const titleLines = doc.splitTextToSize(exp.title, maxW);
          checkNewPage(titleLines.length * 4.5 + 4);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 30, 35);
          doc.text(titleLines, margin, y);
          y += (titleLines.length * 4.5) + 1.5;
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 65);
          for (const bullet of exp.bullets) {
            const cleanBullet = bullet.replace(/^[•\-\*\s]+/, '');
            const bulletLines = doc.splitTextToSize(cleanBullet, maxW - 6);
            checkNewPage(bulletLines.length * 4.2);
            doc.text('•', margin + 2, y);
            doc.text(bulletLines, margin + 6, y);
            y += (bulletLines.length * 4.2);
          }
          y += 3;
        }
        y += 3;
      }
      
      // Projects
      if (resume.projects.length > 0) {
        checkNewPage(18);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('PROJECTS & PORTFOLIO', margin, y);
        y += 5;
        
        for (const proj of resume.projects) {
          const titleLines = doc.splitTextToSize(proj.title, maxW);
          checkNewPage(titleLines.length * 4.5 + 4);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 30, 35);
          doc.text(titleLines, margin, y);
          y += (titleLines.length * 4.5) + 1.5;
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 65);
          for (const bullet of proj.bullets) {
            const cleanBullet = bullet.replace(/^[•\-\*\s]+/, '');
            const bulletLines = doc.splitTextToSize(cleanBullet, maxW - 6);
            checkNewPage(bulletLines.length * 4.2);
            doc.text('•', margin + 2, y);
            doc.text(bulletLines, margin + 6, y);
            y += (bulletLines.length * 4.2);
          }
          y += 3;
        }
        y += 3;
      }
      
      // Education
      if (resume.education.length > 0) {
        checkNewPage(18);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('EDUCATION', margin, y);
        y += 5;
        
        for (const edu of resume.education) {
          const titleLines = doc.splitTextToSize(edu.title, maxW);
          checkNewPage(titleLines.length * 4.5 + 4);
          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          doc.setTextColor(30, 30, 35);
          doc.text(titleLines, margin, y);
          y += (titleLines.length * 4.5) + 1.5;
          
          doc.setFont(fontName, 'normal');
          doc.setFontSize(9);
          doc.setTextColor(70, 70, 75);
          for (const bullet of edu.bullets) {
            const bulletLines = doc.splitTextToSize(bullet, maxW - 6);
            checkNewPage(bulletLines.length * 4.2);
            doc.text(bulletLines, margin + 6, y);
            y += (bulletLines.length * 4.2) + 1;
          }
          y += 2;
        }
        y += 3;
      }
      
      // Skills
      if (resume.skills.length > 0) {
        checkNewPage(15);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(rgb.r, rgb.g, rgb.b);
        doc.text('TECHNICAL SKILLS', margin, y);
        y += 5;
        
        doc.setFont(fontName, 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(50, 50, 55);
        const skillText = resume.skills.map(s => s.replace(/^[•\s\-\*]+/, '')).join(', ');
        const skillLines = doc.splitTextToSize(skillText, maxW);
        doc.text(skillLines, margin, y);
      }
    }
    } // End of if (resumeText)
    
    // ── COVER LETTER EXPORT (If exists) ──────────────────────────────
    if (coverText) {
      if (resumeText) {
        doc.addPage();
      }
      y = margin;
      
      // Letterhead
      doc.setFont(fontName, 'bold');
      doc.setFontSize(16);
      doc.setTextColor(rgb.r, rgb.g, rgb.b);
      doc.text(resume.name || 'Candidate Name', margin, y);
      y += 5;
      
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(110, 110, 120);
      if (resume.contact) {
        doc.text(resume.contact, margin, y);
        y += 5;
      }
      
      doc.setDrawColor(rgb.r, rgb.g, rgb.b);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pageW - margin, y);
      y += 12;
      
      // Title
      doc.setFont(fontName, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 30, 35);
      doc.text('LETTER OF APPLICATION', margin, y);
      y += 8;
      
      // Body Text
      doc.setFont(fontName, 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(50, 50, 55);
      
      const paragraphs = coverText.split('\n');
      for (const p of paragraphs) {
        const trimmedP = p.trim();
        if (!trimmedP) continue;
        
        const pLines = doc.splitTextToSize(trimmedP, maxW);
        // Page boundary check
        if (y + (pLines.length * 4.5) > pageH - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(pLines, margin, y);
        y += (pLines.length * 4.5) + 5; // spacing between paragraphs
      }
    }
    
    doc.save('tailored-resume.pdf');
  } catch (err) {
    console.error('PDF export error:', err);
    alert('PDF export failed. Please check content format.');
  }
});

// ── Save tailored result to history ─────────────────────────────────
document.getElementById('save-btn').addEventListener('click', () => {
  const jd = document.getElementById('jd-input').value;
  const text = document.getElementById('output-text').textContent;
  const gaps = document.getElementById('gaps-text').textContent;
  const scoreVal = parseInt(document.getElementById('score-val').textContent) || 7;
  
  const resultObj = {
    output: text,
    score: scoreVal,
    ats: scoreVal >= 8 ? 'PASS' : 'WARN',
    gaps: gaps
  };
  
  saveToHistory(jd, resultObj);
  
  const btn = document.getElementById('save-btn');
  btn.textContent = '✓ Saved!';
  setTimeout(() => { btn.textContent = '★ Save'; }, 2000);
});

async function saveToHistory(jd, result) {
  const history = JSON.parse(localStorage.getItem('resumeTailorHistory') || '[]');
  const entry = {
    id: Date.now(),
    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    jdSnippet: jd.substring(0, 80) + '...',
    score: result.score,
    output: result.output,
    gaps: result.gaps
  };
  history.unshift(entry);
  const trimmed = history.slice(0, 20); // Keep last 20 adaptations
  localStorage.setItem('resumeTailorHistory', JSON.stringify(trimmed));
}

// ── Load History list ───────────────────────────────────────────────
async function loadHistory() {
  const history = JSON.parse(localStorage.getItem('resumeTailorHistory') || '[]');
  const container = document.getElementById('history-list');
  container.innerHTML = '';
  
  if (history.length === 0) {
    container.innerHTML = '<div class="history-empty">No adapted resumes saved yet.</div>';
    return;
  }
  
  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-card-item';
    
    const scoreColor = entry.score >= 8 ? '#10b981' : entry.score >= 6 ? '#f59e0b' : '#ef4444';
    
    item.innerHTML = `
      <div class="history-item-left">
        <span class="history-item-snippet">${entry.jdSnippet}</span>
        <div class="history-item-meta">
          <span>📅 ${entry.date}</span>
        </div>
      </div>
      <div class="history-item-right">
        <span class="history-score-tag" style="color: ${scoreColor}">${entry.score}/10</span>
        <span class="history-arrow">→</span>
      </div>
    `;
    
    item.addEventListener('click', () => {
      // Reload this historic item to active dashboard result views
      document.getElementById('output-text').textContent = entry.output;
      document.getElementById('gaps-text').textContent = entry.gaps;
      
      const fakeResult = {
        output: entry.output,
        score: entry.score,
        ats: entry.score >= 8 ? 'PASS' : 'WARN',
        gaps: entry.gaps.replace('GAPS TO ADDRESS:\n', '').split('\n\nKEY STRENGTHS:\n')[0],
        strengths: entry.gaps.includes('KEY STRENGTHS:\n') ? entry.gaps.split('KEY STRENGTHS:\n')[1] : ''
      };
      
      displayResult(fakeResult, entry.jdSnippet);
      document.querySelector('.nav-tab[data-tab="dashboard"]').click();
    });
    
    container.appendChild(item);
  });
}

document.getElementById('clear-history-btn').addEventListener('click', () => {
  if (confirm('Are you sure you want to permanently clear all history?')) {
    localStorage.removeItem('resumeTailorHistory');
    loadHistory();
  }
});

// ── Settings configurations ─────────────────────────────────────────
async function loadSettings() {
  let apiKey = '';
  let layout = 'modern';
  let font = 'sans';
  let color = '#8879fc';
  
  if (isExtensionContext) {
    const data = await chrome.storage.local.get(['geminiApiKey', 'templateLayout', 'templateFont', 'templateColor']);
    apiKey = data.geminiApiKey || '';
    layout = data.templateLayout || 'modern';
    font = data.templateFont || 'sans';
    color = data.templateColor || '#8879fc';
  } else {
    apiKey = localStorage.getItem('resumeTailorGeminiApiKey') || '';
    layout = localStorage.getItem('resumeTailorTemplateLayout') || 'modern';
    font = localStorage.getItem('resumeTailorTemplateFont') || 'sans';
    color = localStorage.getItem('resumeTailorTemplateColor') || '#8879fc';
  }
  
  document.getElementById('gemini-api-key').value = apiKey;
  document.getElementById('template-layout').value = layout;
  document.getElementById('template-font').value = font;
  document.getElementById('template-color').value = color;
  document.getElementById('template-color-picker').value = color;
  
  document.querySelectorAll('.color-badge').forEach(badge => {
    if (badge.dataset.color === color) {
      badge.classList.add('active');
    } else {
      badge.classList.remove('active');
    }
  });
}

async function getSettings() {
  if (isExtensionContext) {
    const data = await chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'geminiApiVersion', 'templateLayout', 'templateFont', 'templateColor']);
    return { 
      geminiApiKey: data.geminiApiKey || '',
      geminiModel: data.geminiModel || '',
      geminiApiVersion: data.geminiApiVersion || '',
      templateLayout: data.templateLayout || 'modern',
      templateFont: data.templateFont || 'sans',
      templateColor: data.templateColor || '#8879fc'
    };
  } else {
    const geminiApiKey = localStorage.getItem('resumeTailorGeminiApiKey') || '';
    const geminiModel = localStorage.getItem('resumeTailorGeminiModel') || '';
    const geminiApiVersion = localStorage.getItem('resumeTailorGeminiApiVersion') || '';
    const templateLayout = localStorage.getItem('resumeTailorTemplateLayout') || 'modern';
    const templateFont = localStorage.getItem('resumeTailorTemplateFont') || 'sans';
    const templateColor = localStorage.getItem('resumeTailorTemplateColor') || '#8879fc';
    return { geminiApiKey, geminiModel, geminiApiVersion, templateLayout, templateFont, templateColor };
  }
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const apiKey = document.getElementById('gemini-api-key').value.trim();
  const layout = document.getElementById('template-layout').value;
  const font = document.getElementById('template-font').value;
  const color = document.getElementById('template-color').value;
  
  if (isExtensionContext) {
    await chrome.storage.local.set({ 
      geminiApiKey: apiKey,
      templateLayout: layout,
      templateFont: font,
      templateColor: color
    });
  } else {
    localStorage.setItem('resumeTailorGeminiApiKey', apiKey);
    localStorage.setItem('resumeTailorTemplateLayout', layout);
    localStorage.setItem('resumeTailorTemplateFont', font);
    localStorage.setItem('resumeTailorTemplateColor', color);
  }
  
  const savedMsg = document.getElementById('settings-saved');
  savedMsg.classList.remove('hidden');
  setTimeout(() => savedMsg.classList.add('hidden'), 3000);
});

document.getElementById('test-connection-btn').addEventListener('click', async () => {
  const apiKeyInput = document.getElementById('gemini-api-key').value.trim();
  const testStatus = document.getElementById('test-status');
  
  if (!apiKeyInput) {
    testStatus.textContent = 'Please enter an API key to test.';
    testStatus.className = 'test-status-msg error';
    testStatus.classList.remove('hidden');
    return;
  }
  
  testStatus.textContent = 'Testing connection to Gemini API...';
  testStatus.className = 'test-status-msg info';
  testStatus.classList.remove('hidden');
  
  const endpoints = ['v1beta', 'v1'];
  let success = false;
  let workingVersion = '';
  let modelNames = [];
  let errorMsgs = [];
  
  for (const apiVer of endpoints) {
    try {
      const url = `https://generativelanguage.googleapis.com/${apiVer}/models?key=${apiKeyInput}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const models = data.models || [];
        const generateModels = models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace('models/', ''));
        
        if (generateModels.length > 0) {
          success = true;
          workingVersion = apiVer;
          modelNames = generateModels;
          
          // Resolve best model dynamically
          const preferredModels = [
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-1.5-flash',
            'gemini-2.5-pro',
            'gemini-2.0-pro',
            'gemini-1.5-pro'
          ];
          let bestModel = generateModels[0];
          for (const pref of preferredModels) {
            if (generateModels.includes(pref)) {
              bestModel = pref;
              break;
            }
          }
          
          // Save selected model
          if (isExtensionContext) {
            await chrome.storage.local.set({
              geminiModel: bestModel,
              geminiApiVersion: apiVer
            });
          } else {
            localStorage.setItem('resumeTailorGeminiModel', bestModel);
            localStorage.setItem('resumeTailorGeminiApiVersion', apiVer);
          }
          break;
        }
      } else {
        const errJson = await response.json().catch(() => ({}));
        errorMsgs.push(`${apiVer}: ${errJson.error?.message || response.statusText}`);
      }
    } catch (err) {
      errorMsgs.push(`${apiVer}: ${err.message}`);
    }
  }
  
  if (success) {
    // Retrieve best model from settings to show it
    const settings = await getSettings();
    testStatus.innerHTML = `<strong>✓ Connection successful!</strong><br/>` +
      `API Version: <code>${workingVersion}</code><br/>` +
      `Detected model: <code>${settings.geminiModel}</code><br/>` +
      `Available models: <code>${modelNames.slice(0, 5).join(', ')}</code>` + 
      (modelNames.length > 5 ? ` and ${modelNames.length - 5} more.` : '');
    testStatus.className = 'test-status-msg success';
  } else {
    testStatus.innerHTML = `<strong>✗ Connection failed!</strong><br/>` + errorMsgs.join('<br/>');
    testStatus.className = 'test-status-msg error';
  }
});

// ── App Initialization ──────────────────────────────────────────────
async function initApp() {
  // Initialize theme
  let savedTheme = '';
  if (isExtensionContext) {
    const data = await chrome.storage.local.get('theme');
    savedTheme = data.theme || 'dark';
  } else {
    savedTheme = localStorage.getItem('resumeTailorTheme') || 'dark';
  }
  document.documentElement.setAttribute('data-theme', savedTheme);
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.textContent = savedTheme === 'light' ? '🌙' : '☀';
    themeToggleBtn.addEventListener('click', async () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      themeToggleBtn.textContent = newTheme === 'light' ? '🌙' : '☀';
      if (isExtensionContext) {
        await chrome.storage.local.set({ theme: newTheme });
      } else {
        localStorage.setItem('resumeTailorTheme', newTheme);
      }
    });
  }

  // Load saved configurations
  await loadSettings();
  
  // Reload last parsed base resume if stored
  let savedResume = '';
  let savedFileName = '';
  
  if (isExtensionContext) {
    const data = await chrome.storage.local.get(['baseResume', 'loadedFileName']);
    savedResume = data.baseResume || '';
    savedFileName = data.loadedFileName || '';
  } else {
    savedResume = localStorage.getItem('resumeTailorParsedBaseResume') || '';
    savedFileName = localStorage.getItem('resumeTailorLoadedFileName') || '';
  }
  
  if (savedResume) {
    parsedBaseResumeText = savedResume;
    baseResumeTextArea.value = savedResume;
    
    if (savedFileName) {
      fileStatusName.textContent = savedFileName;
      fileStatusSize.textContent = '';
      fileStatus.classList.remove('hidden');
    }
  }
  
  // Add live auto-save typing listener for base resume manual inputs
  baseResumeTextArea.addEventListener('input', async () => {
    const text = baseResumeTextArea.value.trim();
    parsedBaseResumeText = text;
    if (isExtensionContext) {
      await chrome.storage.local.set({ baseResume: text, loadedFileName: 'manual-paste.txt' });
    } else {
      localStorage.setItem('resumeTailorParsedBaseResume', text);
      localStorage.setItem('resumeTailorLoadedFileName', 'manual-paste.txt');
    }
  });

  // Color palette badge click listeners
  document.querySelectorAll('.color-badge').forEach(badge => {
    badge.addEventListener('click', () => {
      document.querySelectorAll('.color-badge').forEach(b => b.classList.remove('active'));
      badge.classList.add('active');
      const color = badge.dataset.color;
      document.getElementById('template-color').value = color;
      document.getElementById('template-color-picker').value = color;
    });
  });

  // Custom color picker change listener
  document.getElementById('template-color-picker').addEventListener('input', (e) => {
    document.querySelectorAll('.color-badge').forEach(b => b.classList.remove('active'));
    document.getElementById('template-color').value = e.target.value;
  });
}

initApp();