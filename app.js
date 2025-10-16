'use strict';

// Tenant scope - hard requirement from user
const TENANT_ID = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

// Global state
let supabaseClient = null;
let cachedSubjects = [];
let selectedClass = null;
let selectedStudent = null;
let isDesignMode = false; // Track if we're in hall ticket design mode or student selection mode
// Bulk preview state
let isBulkMode = false;
let bulkPreviewImages = []; // array of {url, width, height}

// Caches to speed up bulk exports
let schoolDetailsCache = null;
const fatherNameCache = new Map(); // studentId -> father name
const photoUrlCache = new Map();   // studentId -> photo URL

// Helpers
function parseEnv(text) {
  const out = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    out[key] = val;
  });
  return out;
}

async function loadCredentials() {
  // Try common file names in order
  const candidates = ['credentials.txt', 'credentials.txt.txt'];
  for (const path of candidates) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (res.ok) {
        const txt = await res.text();
        const env = parseEnv(txt);
        // Support both SUPABASE_URL and potential typo keys
        const url = env.SUPABASE_URL || env.RSUPABASE_URL || env.SUPABASE_PROJECT_URL;
        const anon = env.SUPABASE_ANON_KEY || env.ANON_KEY;
        if (!url || !anon) {
          throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in credentials file.');
        }
        return { url, anon };
      }
    } catch (_) {
      // continue
    }
  }
  throw new Error('credentials file not found or unreadable. Place SUPABASE_URL and SUPABASE_ANON_KEY in credentials.txt');
}

function createSbClient(url, anon) {
  const { createClient } = window.supabase;
  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { 'x-application-name': 'hallticket-global' } },
  });
}

async function fetchSchoolDetails() {
  if (schoolDetailsCache) return schoolDetailsCache;
  const { data, error } = await supabaseClient
    .from('school_details')
    .select('name,address,city,state,pincode,logo_url,principal_name')
    .eq('tenant_id', TENANT_ID)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  schoolDetailsCache = data;
  return data;
}

async function fetchClasses() {
  const { data, error } = await supabaseClient
    .from('classes')
    .select('id,class_name,section')
    .eq('tenant_id', TENANT_ID)
    .order('class_name', { ascending: true })
    .order('section', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchStudentsByClass(classId) {
  const { data, error } = await supabaseClient
    .from('students')
    .select('id,name,admission_no,roll_no')
    .eq('tenant_id', TENANT_ID)
    .eq('class_id', classId)
    .order('roll_no', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchSubjectsByClass(classId) {
  const { data, error } = await supabaseClient
    .from('subjects')
    .select('id,name')
    .eq('tenant_id', TENANT_ID)
    .eq('class_id', classId)
    .order('name', { ascending: true });
  if (error) return [];
  return data || [];
}

function el(sel) { return document.querySelector(sel); }
function cls(sel) { return document.querySelectorAll(sel); }
function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

function renderClassesDropdown(classes) {
  const sel = el('#classSelect');
  sel.innerHTML = '<option value="">-- Choose a class --</option>' +
    classes.map(c => {
      const label = [c.class_name, c.section].filter(Boolean).join(' - ');
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
    }).join('');
}

function renderStudentsGrid(students) {
  const grid = el('#studentsGrid');
  const empty = el('#studentsEmpty');
  grid.innerHTML = '';
  if (!students.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const s of students) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = s.id;
    card.innerHTML = `
      <div class="title">${escapeHtml(s.name || '-')}</div>
      <div class="sub">Roll No: ${escapeHtml(String(s.roll_no ?? '-'))}</div>
      <div class="sub">Admission No: ${escapeHtml(s.admission_no || '-')}</div>
    `;
    card.addEventListener('click', () => handleStudentClick(s));
    grid.appendChild(card);
  }
}


function openOverlay() {
  const ov = el('#ticketOverlay');
  ov.classList.remove('hidden');
  ov.setAttribute('aria-hidden', 'false');
}
function closeOverlay() {
  const ov = el('#ticketOverlay');
  ov.classList.add('hidden');
  ov.setAttribute('aria-hidden', 'true');
  isDesignMode = false;
  // reset bulk preview visibility/state
  const bulk = el('#bulkTicketsArea');
  if (bulk) {
    bulk.classList.add('hidden');
    bulk.innerHTML = '';
  }
  const single = el('#ticketArea');
  if (single) single.classList.remove('offscreen-capture');
  isBulkMode = false;
  bulkPreviewImages = [];
}

function setDesignModeUI() {
  // Show print/download buttons for design mode
  el('#printTicket').classList.remove('hidden');
  el('#downloadPdf').classList.remove('hidden');
  // Hide back button while designing
  const backBtn = el('#backToDesign');
  if (backBtn) backBtn.classList.add('hidden');
}

function setStudentModeUI() {
  // Show print/download buttons
  el('#printTicket').classList.remove('hidden');
  el('#downloadPdf').classList.remove('hidden');
  // Keep exam name input and add subject buttons visible
  el('#examName').style.display = 'block';
  el('#addSubjectRow').style.display = 'block';
}

async function showSubjectDesignSection(classData) {
  // Update class name display
  const classLabel = [classData.class_name, classData.section].filter(Boolean).join(' - ');
  el('#selectedClassName').textContent = `${classLabel} - Subject Design`;
  
  // Fetch subjects suggestions for current class
  cachedSubjects = await fetchSubjectsByClass(classData.id);
  renderSubjectsDatalist(cachedSubjects);
  
  // Clear previous subjects and add one default row
  clearSubjectsRows();
  addSubjectRow();
  
  // Show subject design section, hide students section
  el('#subjectDesignSection').classList.remove('hidden');
  el('#studentsSection').classList.add('hidden');
  
  // Clear exam name
  el('#examName').value = '';
}

async function startHallTicketDesign(classData) {
  isDesignMode = true;
  const classLabel = [classData.class_name, classData.section].filter(Boolean).join(' - ');
  const examName = el('#examName').value.trim();

  // Fetch subjects suggestions for current class
  cachedSubjects = await fetchSubjectsByClass(classData.id);
  renderSubjectsDatalist(cachedSubjects);

  // Set school header in the ticket area
  const details = await fetchSchoolDetails();
  setSchoolHeaderOnTicket(details);

  // Populate template student info for design
  el('#tStudentName').textContent = 'Student Name';
  const tAdmissionNo = el('#tAdmissionNo'); if (tAdmissionNo) tAdmissionNo.textContent = 'Admission No';
  const tRollNo = el('#tRollNo'); if (tRollNo) tRollNo.textContent = 'Roll No';
  const tClass = el('#tClass'); if (tClass) tClass.textContent = classLabel || '-';
  const tExamEl = el('#tExam'); if (tExamEl) tExamEl.textContent = examName || 'Exam Name';
  const today = new Date();
  const tDate = el('#tDate'); if (tDate) tDate.textContent = formatDate(today);
  const tSem = el('#tSem'); if (tSem) tSem.textContent = '-';
  const tSession = el('#tSession'); if (tSession) tSession.textContent = `${today.toLocaleString(undefined, { month: 'long' })} ${today.getFullYear()}`;
  const tFatherName = el('#tFatherName'); if (tFatherName) tFatherName.textContent = 'Father Name';

  // Reset subject rows with one default row
  clearSubjectsRows();
  addSubjectRow();
  updateSubjectsPrinted();

  // Set UI to design mode
  setDesignModeUI();
  openOverlay();
}

async function showStudentsForIndividualTickets() {
  if (!selectedClass) return;
  
  // Load and display students for individual ticket selection
  const students = await fetchStudentsByClass(selectedClass.id);
  renderStudentsGrid(students);
  
  // Show students section, hide subject design
  el('#subjectDesignSection').classList.add('hidden');
  el('#studentsSection').classList.remove('hidden');
  el('#backToSubjects').classList.remove('hidden');
}

async function generateFullClassTickets() {
  if (!selectedClass) return;

  // Allow empty exam name; fall back to default later
  const examName = el('#examName').value.trim();
  if (!examName) {
    el('#examName').value = 'Examination';
  }

  // Load all students
  const students = await fetchStudentsByClass(selectedClass.id);
  if (students.length === 0) {
    alert('No students found in this class');
    return;
  }

  // Prepare overlay and bulk preview area
  openOverlay();
  const bulk = el('#bulkTicketsArea');
  const single = el('#ticketArea');
  if (bulk && single) {
    bulk.classList.remove('hidden');
    // keep single ticket in DOM for html2canvas capture, but move it offscreen
    single.classList.add('offscreen-capture');
  }
  isBulkMode = true;
  bulkPreviewImages = [];
  if (bulk) bulk.innerHTML = '';

  const classLabel = [selectedClass.class_name, selectedClass.section].filter(Boolean).join(' - ');
  const nameForExam = el('#examName').value.trim();

  // Ensure previews use the exact PDF formatting (e.g., bottom-right signature)
  const ticketArea = el('#ticketArea');
  ticketArea.classList.add('pdf-mode');

  // Render preview images for each student sequentially to avoid ID conflicts and heavy DOM cloning
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    await populateTicketForPDF(student, classLabel, nameForExam);
    const ticketEl = el('#originalTicket');
    // Hide photo error to avoid showing red text in previews
    const errEl = el('#tPhotoError');
    const wasHidden = errEl ? errEl.classList.contains('hidden') : true;
    if (errEl) errEl.classList.add('hidden');
    const canvas = await html2canvas(ticketEl, { scale: 1.3, useCORS: true, backgroundColor: '#ffffff' });
    if (errEl && !wasHidden) errEl.classList.remove('hidden');
    const url = canvas.toDataURL('image/png');
    bulkPreviewImages.push({ url, width: canvas.width, height: canvas.height });
    if (bulk) {
      const img = document.createElement('img');
      img.className = 'ticket-preview';
      img.src = url;
      img.alt = `Ticket ${i + 1}`;
      bulk.appendChild(img);
      if ((i + 1) % 2 === 0) {
        const sep = document.createElement('div');
        sep.className = 'page-sep';
        sep.textContent = `--- Page ${Math.ceil((i + 1) / 2)} ---`;
        bulk.appendChild(sep);
      }
    }
  }

  // Remove PDF formatting from the hidden ticket after preview generation
  ticketArea.classList.remove('pdf-mode');
}

async function generateBulkTicketsPDF(students) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4'); // Use portrait for 2 tickets per page

  const classLabel = [selectedClass.class_name, selectedClass.section].filter(Boolean).join(' - ');
  const examName = el('#examName').value.trim();

  // Prefetch and cache school + student meta to avoid per-student network calls
  try { await fetchSchoolDetails(); } catch (_) {}
  try { await prefetchStudentMeta(students); } catch (_) {}

  // Ensure ticket is visible for html2canvas capture
  const overlay = el('#ticketOverlay');
  const wasHidden = overlay.classList.contains('hidden');
  if (wasHidden) {
    openOverlay();
  }
  const ticketArea = el('#ticketArea');
  ticketArea.classList.add('pdf-mode');

  let isFirstPage = true;

  // Render two students per page
  for (let i = 0; i < students.length; i += 2) {
    const pageStudents = students.slice(i, i + 2);

    if (!isFirstPage) {
      pdf.addPage();
    }
    isFirstPage = false;

    // Function to capture a student's ticket as canvas data URL
    const renderStudent = async (stu) => {
      await populateTicketForPDF(stu, classLabel, examName);
      const ticketEl = el('#originalTicket');
const canvas = await html2canvas(ticketEl, { scale: 1.3, useCORS: true, backgroundColor: '#ffffff' });
      return { canvas, dataUrl: canvas.toDataURL('image/png') };
    };

    // Render all students for this page
    const studentImages = [];
    for (const student of pageStudents) {
      const img = await renderStudent(student);
      studentImages.push(img);
    }

    if (studentImages.length === 0) continue;

    // Compute sizes for 2 tickets per page (top and bottom)
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const gap = 10;

    const cols = 1;
    const rows = 2;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;

    const cellWidth = contentWidth;
    const cellHeight = (contentHeight - gap) / rows;

    // Place images vertically (top and bottom)
    const positions = [
      { row: 0, col: 0 },
      { row: 1, col: 0 }
    ];

    const startX = margin;
    const startY = margin;

    for (let j = 0; j < studentImages.length; j++) {
      const pos = positions[j];
      const x = startX;
      const y = startY + pos.row * (cellHeight + gap);
      pdf.addImage(studentImages[j].dataUrl, 'PNG', x, y, cellWidth, cellHeight);
    }
  }

  ticketArea.classList.remove('pdf-mode');
  if (wasHidden) {
    closeOverlay();
  }

  // Save PDF
  const className = [selectedClass.class_name, selectedClass.section].filter(Boolean).join('_');
  pdf.save(`${className}_all_hall_tickets.pdf`);
}

async function populateTicketForPDF(student, classLabel, examName) {
  // Set school header
  const details = await fetchSchoolDetails();
  setSchoolHeaderOnTicket(details);
  
  // Populate student info
  populateTicketStudentInfo(student, classLabel, examName);
  
  // Fetch father name and photo (use caches for speed)
  const [fatherName, photoUrl] = await Promise.all([
    fetchFatherName(student.id),
    fetchStudentPhotoUrl(student.id)
  ]);
  const fEl = el('#tFatherName'); if (fEl) fEl.textContent = fatherName || '-';
  setStudentPhoto(photoUrl);
  
  updateSubjectsPrinted();
  
  // Wait for images inside the ticket to load (logo, photo, watermark) - increased timeout
  await waitForImages(document.getElementById('originalTicket'), 5000);
}

function setSchoolHeaderOnPage(details) {
  const logo = el('#schoolLogo');
  const name = el('#schoolName');
  const addr = el('#schoolAddress');
  if (details) {
    name.textContent = details.name || 'School Name';
    const address = [details.address, details.city, details.state, details.pincode].filter(Boolean).join(', ');
    addr.textContent = address || '-';
    if (details.logo_url) logo.src = details.logo_url; else logo.removeAttribute('src');
  }
}

function setSchoolHeaderOnTicket(details) {
  const tLogo = el('#tSchoolLogo');
  const tName = el('#tSchoolName');
  const tAddr = el('#tSchoolAddress');
  if (tLogo) tLogo.crossOrigin = 'anonymous';
  if (details) {
    tName.textContent = details.name || 'School Name';
    const address = [details.address, details.city, details.state, details.pincode].filter(Boolean).join(', ');
    if (tAddr) tAddr.textContent = address || '-';
    if (details.logo_url) tLogo.src = details.logo_url; else tLogo.removeAttribute('src');
  }
  // Set centered watermark image to school logo (or hide if none)
  const wm = el('#ticketWatermark');
  if (wm) {
    wm.crossOrigin = 'anonymous';
    if (details && details.logo_url) {
      wm.src = details.logo_url;
      wm.style.display = '';
    } else {
      wm.removeAttribute('src');
      wm.style.display = 'none';
    }
  }
}

function clearSubjectsRows() {
  el('#subjectsBody').innerHTML = '';
}

function addSubjectRow(prefillName = '') {
  const subjectsBody = el('#subjectsBody');
  const subjectNumber = subjectsBody.children.length + 1;

  const subjectSection = document.createElement('div');
  subjectSection.className = 'subject-section';
  subjectSection.innerHTML = `
    <div class="subject-header">
      <h4>Subject ${subjectNumber}</h4>
    </div>
    <div class="subject-fields">
      <div class="field-group">
        <label>Subject Name:</label>
        <input class="subject-input" type="text" list="subjectsList" placeholder="Subject name" value="${escapeHtml(prefillName)}" />
      </div>
      <div class="field-group">
        <label>Date:</label>
        <input class="subject-input" type="date" />
      </div>
      <div class="field-group time-range">
        <label>Time:</label>
        <div class="time-inputs">
          <input class="subject-input time-input" type="time" placeholder="From" title="Start time" />
          <span class="time-separator">to</span>
          <input class="subject-input time-input" type="time" placeholder="To" title="End time" />
        </div>
      </div>
    </div>
  `;
  subjectsBody.appendChild(subjectSection);
  // Update printed list when any input changes
  subjectSection.querySelectorAll('.subject-input').forEach(inp => {
    inp.addEventListener('input', updateSubjectsPrinted);
  });
  updateSubjectsPrinted();
  return subjectSection;
}

function renderSubjectsDatalist(subjects) {
  // Create or replace datalist for subject names
  let dl = document.getElementById('subjectsList');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'subjectsList';
    document.body.appendChild(dl);
  }
  dl.innerHTML = subjects.map(s => `<option value="${escapeHtml(s.name)}"></option>`).join('');
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Progress helpers
function showProgress(total) {
  const cont = el('#downloadProgress');
  if (!cont) return;
  cont.classList.remove('hidden');
  cont.dataset.total = String(total || 0);
  updateProgress(0, total || 0);
}
function updateProgress(current, total) {
  const bar = el('#downloadProgressBar');
  const txt = el('#downloadProgressText');
  if (!bar || !txt) return;
  const pct = total ? Math.round((current / total) * 100) : 0;
  bar.style.width = `${pct}%`;
  txt.textContent = `Preparing ${pct}% (${current}/${total})`;
}
function setProgressMessage(msg) {
  const txt = el('#downloadProgressText');
  if (txt) txt.textContent = msg;
}
function hideProgress() {
  const cont = el('#downloadProgress');
  const bar = el('#downloadProgressBar');
  const txt = el('#downloadProgressText');
  if (cont) cont.classList.add('hidden');
  if (bar) bar.style.width = '0%';
  if (txt) txt.textContent = '';
}

function formatTime12h(hhmm) {
  if (!hhmm) return '';
  const parts = hhmm.split(':');
  if (parts.length < 2) return hhmm;
  let h = parseInt(parts[0], 10);
  const m = parts[1] ?? '00';
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
}


async function fetchFatherName(studentId) {
  if (fatherNameCache.has(studentId)) return fatherNameCache.get(studentId);
  try {
    const { data } = await supabaseClient
      .from('parents')
      .select('name')
      .eq('tenant_id', TENANT_ID)
      .eq('student_id', studentId)
      .eq('relation', 'Father')
      .maybeSingle();
    const name = data?.name || '-';
    fatherNameCache.set(studentId, name);
    return name;
  } catch (_) {
    const name = '-';
    fatherNameCache.set(studentId, name);
    return name;
  }
}

function setStudentPhoto(photoUrl) {
  const pEl = el('#tPhoto');
  const errEl = el('#tPhotoError');
  
  if (!pEl || !errEl) {
    console.error('❌ Photo elements not found in DOM');
    return;
  }
  
  console.log(`🖼️ Setting student photo: ${photoUrl || 'empty'}`);
  
  // Clear existing handlers and state
  pEl.onerror = null;
  pEl.onload = null;
  pEl.removeAttribute('src');
  
  if (!photoUrl) {
    console.log('⚠️ No photo URL provided, showing error state');
    errEl.classList.remove('hidden');
    errEl.textContent = 'Photo not available';
    return;
  }
  
  // Set CORS attributes more thoroughly
  pEl.crossOrigin = 'anonymous';
  pEl.setAttribute('crossorigin', 'anonymous');
  
  // Set up error handler
  pEl.onerror = function(event) {
    console.error(`❌ Photo failed to load: ${photoUrl}`, event);
    errEl.classList.remove('hidden');
    errEl.textContent = 'Photo failed to load';
    pEl.removeAttribute('src');
  };
  
  // Set up success handler
  pEl.onload = function() {
    console.log(`✅ Photo loaded successfully: ${photoUrl} (${this.naturalWidth}x${this.naturalHeight})`);
    errEl.classList.add('hidden');
  };
  
  // Hide error initially
  errEl.classList.add('hidden');
  
  // Set the source (this will trigger loading)
  pEl.src = photoUrl;
}

async function waitForImages(root, timeoutMs = 3000) {
  const imgs = Array.from(root.querySelectorAll('img'));
  console.log(`⏳ Waiting for ${imgs.length} images to load...`);
  
  if (imgs.length === 0) {
    console.log('✅ No images to wait for');
    return;
  }
  
  const waiters = imgs.map((img, index) => {
    // If image is already loaded
    if (img.complete && img.naturalWidth > 0) {
      console.log(`✅ Image ${index + 1} already loaded`);
      return Promise.resolve();
    }
    
    // If image has no src, don't wait for it
    if (!img.src) {
      console.log(`⚠️ Image ${index + 1} has no src`);
      return Promise.resolve();
    }
    
    return new Promise(resolve => {
      const cleanup = () => {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      };
      
      const onLoad = () => {
        console.log(`✅ Image ${index + 1} loaded successfully`);
        cleanup();
        resolve();
      };
      
      const onError = (event) => {
        console.error(`❌ Image ${index + 1} failed to load:`, img.src, event);
        cleanup();
        resolve(); // Resolve anyway to not block the process
      };
      
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
    });
  });
  
  const timeout = new Promise(resolve => {
    setTimeout(() => {
      console.log(`⏰ Image loading timeout after ${timeoutMs}ms`);
      resolve();
    }, timeoutMs);
  });
  
  await Promise.race([Promise.all(waiters), timeout]);
  console.log('✅ Image waiting completed');
}

async function fetchStudentPhotoUrl(studentId) {
  console.log(`🔍 Fetching photo for student ID: ${studentId}`);
  
  if (photoUrlCache.has(studentId)) {
    const cachedUrl = photoUrlCache.get(studentId);
    console.log(`📋 Using cached photo URL: ${cachedUrl || 'empty'}`);
    return cachedUrl;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('students')
      .select('id,photo_url')
      .eq('tenant_id', TENANT_ID)
      .eq('id', studentId)
      .maybeSingle();
    
    if (error) {
      console.error(`❌ Database error fetching photo for student ${studentId}:`, error);
      photoUrlCache.set(studentId, '');
      return '';
    }
    
    if (!data) {
      console.log(`⚠️ Student not found: ${studentId}`);
      photoUrlCache.set(studentId, '');
      return '';
    }
    
    const url = data.photo_url || '';
    console.log(`📷 Found photo URL for student ${studentId}: ${url || 'empty'}`);
    
    photoUrlCache.set(studentId, url);
    return url;
    
  } catch (error) {
    console.error(`💥 Exception fetching photo for student ${studentId}:`, error);
    photoUrlCache.set(studentId, '');
    return '';
  }
}

function updateSubjectsPrinted() {
  const tbody = el('#tSubjectsTableBody');
  if (!tbody) return;
  const rows = Array.from(document.querySelectorAll('#subjectsBody .subject-section'));
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No subjects registered</td></tr>';
    return;
  }
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth()+1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  };
  const html = rows.map((row) => {
    const vals = Array.from(row.querySelectorAll('.subject-fields .subject-input'));
    const name = vals[0]?.value?.trim() || '';
    const date = fmtDate(vals[1]?.value || '');
    const from = vals[2]?.value || '';
    const to = vals[3]?.value || '';
    const time = from && to 
      ? `${formatTime12h(from)} - ${formatTime12h(to)}` 
      : (from ? formatTime12h(from) : (to ? formatTime12h(to) : ''));
    return `<tr><td>${escapeHtml(date)}</td><td>${escapeHtml(time)}</td><td>${escapeHtml(name)}</td><td class="sig-cell"><div class="sigline"></div></td></tr>`;
  }).join('');
  tbody.innerHTML = html || '<tr><td colspan="4" class="empty">No subjects registered</td></tr>';
}

function populateTicketStudentInfo(student, classLabel, examName) {
  el('#tStudentName').textContent = student.name || '-';
  const tAdmissionNo = el('#tAdmissionNo'); if (tAdmissionNo) tAdmissionNo.textContent = student.admission_no || '-';
  const tRollNo = el('#tRollNo'); if (tRollNo) tRollNo.textContent = (student.roll_no ?? '-');
  const tClass = el('#tClass'); if (tClass) tClass.textContent = classLabel || '-';
  const tExamEl = el('#tExam'); if (tExamEl) tExamEl.textContent = examName || '-';
  const today = new Date();
  const tDate = el('#tDate'); if (tDate) tDate.textContent = formatDate(today);
  const tSem = el('#tSem'); if (tSem) tSem.textContent = '-';
  const tSession = el('#tSession'); if (tSession) tSession.textContent = `${today.toLocaleString(undefined, { month: 'long' })} ${today.getFullYear()}`;
  updateSubjectsPrinted();
}


async function handleStudentClick(student) {
  selectedStudent = student;
  
  const classSel = el('#classSelect');
  const classLabel = classSel.options[classSel.selectedIndex]?.text || '';
  const examName = el('#examName').value.trim() || 'Examination';

  // Set school header in the ticket area
  const details = await fetchSchoolDetails();
  setSchoolHeaderOnTicket(details);

  // Populate student info
  populateTicketStudentInfo(student, classLabel, examName);

  // Fetch father name and photo if available
  const [fatherName, photoUrl] = await Promise.all([
    fetchFatherName(student.id),
    fetchStudentPhotoUrl(student.id)
  ]);
  const fEl = el('#tFatherName'); if (fEl) fEl.textContent = fatherName || '-';
  setStudentPhoto(photoUrl);
  
  // Reset subject rows with one default row if none exist
  if (el('#subjectsBody').children.length === 0) {
    addSubjectRow();
  }
  updateSubjectsPrinted();

  // Set UI to student mode
  setStudentModeUI();
  openOverlay();
}


function getTicketHtmlForPdf() {
  // Return the element to render as PDF (inner ticket only)
  return document.getElementById('originalTicket');
}

async function downloadTicketAsPdf() {
  const { jsPDF } = window.jspdf;

  // If we are in bulk preview mode, export all tickets in a grid
  if (isBulkMode) {
    // Always regenerate images with PDF mode to ensure signature lines are hidden in PDF
    let images = [];
    try {
      const students = selectedClass ? await fetchStudentsByClass(selectedClass.id) : [];
      showProgress(students.length);
      // Prefetch metadata to speed up per-student rendering
      try { await fetchSchoolDetails(); } catch (_) {}
      try { await prefetchStudentMeta(students); } catch (_) {}

      // Ensure PDF-only styles are active during capture
      const ticketArea = el('#ticketArea');
      ticketArea.classList.add('pdf-mode');

      for (let i = 0; i < students.length; i++) {
        const student = students[i];
        const classLabel = [selectedClass.class_name, selectedClass.section].filter(Boolean).join(' - ');
        const nameForExam = el('#examName').value.trim();
        await populateTicketForPDF(student, classLabel, nameForExam);
        const ticketEl = el('#originalTicket');
        // Temporarily hide photo error while capturing PDF snapshot
        const errEl = el('#tPhotoError');
        const wasHidden = errEl ? errEl.classList.contains('hidden') : true;
        if (errEl) errEl.classList.add('hidden');
        const canvas = await html2canvas(ticketEl, { scale: 1.3, useCORS: true, backgroundColor: '#ffffff', logging: false });
        if (errEl && !wasHidden) errEl.classList.remove('hidden');
        images.push({ url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        updateProgress(i + 1, students.length);
      }

      // Turn off PDF-only styles after capture
      ticketArea.classList.remove('pdf-mode');
    } catch (_) {
      // If something went wrong, fall back to whatever previews we have
      images = bulkPreviewImages.slice();
      showProgress(images.length);
      updateProgress(images.length, images.length);
    }

    if (!images.length) {
      alert('No tickets to export. Please generate full class tickets first.');
      return;
    }

    // Use portrait for 2 tickets per page (top and bottom)
    const pdf = new jsPDF('p', 'pt', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const gap = 10;

    // Layout 2 tickets per page vertically
    const cols = 1;
    const rows = 2;
    setProgressMessage('Generating PDF...');
    for (let pageStart = 0; pageStart < images.length; pageStart += cols * rows) {
      if (pageStart !== 0) pdf.addPage();

      // Gather up to 2 images for this page
      const pageImgs = images.slice(pageStart, pageStart + cols * rows);

      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2;

      const cellWidth = contentWidth;
      const cellHeight = (contentHeight - gap) / rows;

      const startX = margin;
      const startY = margin;
      
      for (let i = 0; i < pageImgs.length; i++) {
        const img = pageImgs[i];
        const x = startX;
        const y = startY + i * (cellHeight + gap);
        pdf.addImage(img.url, 'PNG', x, y, cellWidth, cellHeight);
      }
    }

    const className = [selectedClass?.class_name, selectedClass?.section].filter(Boolean).join('_') || 'class';
    pdf.save(`${className}_all_hall_tickets.pdf`);
    hideProgress();
    return;
  }

  // Single-ticket fallback (original behaviour)
  const ticketEl = getTicketHtmlForPdf();
  updateSubjectsPrinted();
  // Apply PDF-only styles on the container so signature lines are hidden
  const ticketAreaSingle = el('#ticketArea');
  ticketAreaSingle.classList.add('pdf-mode');
  // Temporarily hide photo error while capturing single-ticket PDF
  const errElSingle = el('#tPhotoError');
  const wasHiddenSingle = errElSingle ? errElSingle.classList.contains('hidden') : true;
  if (errElSingle) errElSingle.classList.add('hidden');
  const canvas = await html2canvas(ticketEl, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' });
  if (errElSingle && !wasHiddenSingle) errElSingle.classList.remove('hidden');
  const imgData = canvas.toDataURL('image/png');
  // Remove PDF-only styles before building PDF
  ticketAreaSingle.classList.remove('pdf-mode');
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const margin = 10;
  let targetWidth = pageWidth - margin * 2;
  let targetHeight = canvas.height * (targetWidth / canvas.width);


  const availableHeight = pageHeight - margin * 2;
  if (targetHeight > availableHeight) {
    const ratio = availableHeight / targetHeight;
    targetWidth *= ratio;
    targetHeight *= ratio;
  }
  pdf.addImage(imgData, 'PNG', margin, margin, targetWidth, targetHeight);

  const studentName = (selectedStudent?.name || 'ticket').replace(/[^a-z0-9_-]/gi, '_');
  const filename = `${studentName}_hall_ticket.pdf`;
  pdf.save(filename);
  ticketEl.classList.remove('pdf-mode');
}

function printTicket() {
  window.print();
}

function focusNextSubjectInput(currentEl) {
  const allInputs = Array.from(document.querySelectorAll('#subjectsBody .subject-input'));
  const idx = allInputs.indexOf(currentEl);
  if (idx === -1) return;
  if (idx < allInputs.length - 1) {
    allInputs[idx + 1].focus();
  } else {
    const newSection = addSubjectRow();
    const first = newSection ? newSection.querySelector('.subject-input') : null;
    if (first) first.focus();
  }
}

async function prefetchStudentMeta(students) {
  const ids = Array.from(new Set(students.map(s => s.id))).filter(Boolean);
  if (!ids.length) return;
  try {
    // Fathers
    const { data: fathers } = await supabaseClient
      .from('parents')
      .select('student_id,name,relation')
      .eq('tenant_id', TENANT_ID)
      .in('student_id', ids)
      .eq('relation', 'Father');
    if (Array.isArray(fathers)) {
      for (const row of fathers) {
        fatherNameCache.set(row.student_id, row.name || '-');
      }
    }
  } catch (_) {}
  try {
    // Photos from students table
    const { data: photos } = await supabaseClient
      .from('students')
      .select('id,photo_url')
      .eq('tenant_id', TENANT_ID)
      .in('id', ids);
    if (Array.isArray(photos)) {
      for (const row of photos) {
        photoUrlCache.set(row.id, row.photo_url || '');
      }
    }
  } catch (_) {}
}

async function downloadAllTicketsNow() {
  if (!selectedClass) {
    alert('Please select a class first.');
    return;
  }
  // Fetch all students once and generate PDF directly (no preview)
  const students = await fetchStudentsByClass(selectedClass.id);
  if (!students || students.length === 0) {
    alert('No students found in this class');
    return;
  }
  await generateBulkTicketsPDF(students);
}

async function init() {
  try {
    // Load credentials without logging secrets
    const { url, anon } = await loadCredentials();
    supabaseClient = createSbClient(url, anon);

    // School header in app header
    const details = await fetchSchoolDetails();
    setSchoolHeaderOnPage(details);

    // Load classes
    const classes = await fetchClasses();
    renderClassesDropdown(classes);

    // Bind events
    el('#classSelect').addEventListener('change', async (e) => {
      const classId = e.target.value;
      selectedClass = classes.find(c => c.id === classId) || null;
      if (!classId) {
        // Hide subject design section and students
        el('#subjectDesignSection').classList.add('hidden');
        el('#studentsSection').classList.add('hidden');
        return;
      }
      // Show subject design section
      await showSubjectDesignSection(selectedClass);
    });

    el('#addSubjectRow').addEventListener('click', () => addSubjectRow());
    el('#addSubjectRowFloat').addEventListener('click', () => addSubjectRow());
    el('#showStudents').addEventListener('click', showStudentsForIndividualTickets);
    el('#generateFullClass').addEventListener('click', generateFullClassTickets);
    el('#backToSubjects').addEventListener('click', () => {
      if (selectedClass) showSubjectDesignSection(selectedClass);
    });
el('#closeOverlay').addEventListener('click', closeOverlay);
el('#printTicket').addEventListener('click', printTicket);
el('#downloadPdf').addEventListener('click', downloadTicketAsPdf);
const downloadAllBtn = document.getElementById('downloadAllPdf');
if (downloadAllBtn) downloadAllBtn.addEventListener('click', downloadAllTicketsNow);
el('#subjectsBody').addEventListener('input', () => updateSubjectsPrinted());

    // Back button: return to hall ticket design overlay
    const backBtn = el('#backToDesign');
    if (backBtn) {
      backBtn.addEventListener('click', async () => {
        if (!selectedClass) return;
        isDesignMode = true;
        setDesignModeUI();
        openOverlay();
      });
    }

    // Keyboard navigation: Enter moves to next subject input; at the end, add a new row
    el('#subjectsBody').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('subject-input')) {
        e.preventDefault();
        focusNextSubjectInput(e.target);
      }
    });
  } catch (err) {
    alert(err.message || String(err));
  }
}

// Bootstrap after DOM is ready
document.addEventListener('DOMContentLoaded', init);