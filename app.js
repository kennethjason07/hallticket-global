'use strict';

// Tenant scope - hard requirement from user
const TENANT_ID = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

// Global state
let supabaseClient = null;
let cachedSubjects = [];
let selectedClass = null;
let selectedStudent = null;
let isDesignMode = false; // Track if we're in hall ticket design mode or student selection mode

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
  const { data, error } = await supabaseClient
    .from('school_details')
    .select('name,address,city,state,pincode,logo_url,principal_name')
    .eq('tenant_id', TENANT_ID)
    .limit(1)
    .maybeSingle();
  if (error) return null;
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
  el('#tAdmissionNo').textContent = 'Admission No';
  el('#tRollNo').textContent = 'Roll No';
  const tClass = el('#tClass'); if (tClass) tClass.textContent = classLabel || '-';
  el('#tExam').textContent = examName || 'Exam Name';
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
  
  const examName = el('#examName').value.trim();
  if (!examName) {
    alert('Please enter an exam name before generating tickets');
    return;
  }
  
  // Check if subjects are added
  const subjectRows = document.querySelectorAll('#subjectsBody .subject-section');
  if (subjectRows.length === 0) {
    alert('Please add at least one subject before generating tickets');
    return;
  }
  
  // Get all students in the class
  const students = await fetchStudentsByClass(selectedClass.id);
  if (students.length === 0) {
    alert('No students found in this class');
    return;
  }
  
  // Generate PDF with all student tickets
  await generateBulkTicketsPDF(students);
}

async function generateBulkTicketsPDF(students) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  
  const classLabel = [selectedClass.class_name, selectedClass.section].filter(Boolean).join(' - ');
  const examName = el('#examName').value.trim();
  
  let isFirstPage = true;
  
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    
    if (!isFirstPage) {
      pdf.addPage();
    }
    isFirstPage = false;
    
    // Populate ticket for this student
    await populateTicketForPDF(student, classLabel, examName);
    
    // Capture the ticket as image
    const ticketEl = el('#originalTicket');
    const canvas = await html2canvas(ticketEl, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    
    // Add to PDF
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 40; // 20pt margin on each side
    const imgHeight = canvas.height * (imgWidth / canvas.width);
    
    pdf.addImage(imgData, 'PNG', 20, 20, imgWidth, Math.min(imgHeight, pageHeight - 40));
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
  
  // Fetch father name and photo
  const [fatherName, photoUrl] = await Promise.all([
    fetchFatherName(student.id),
    fetchStudentPhotoUrl(student.id)
  ]);
  const fEl = el('#tFatherName'); if (fEl) fEl.textContent = fatherName || '-';
  const pEl = el('#tPhoto'); if (pEl) { if (photoUrl) pEl.src = photoUrl; else pEl.removeAttribute('src'); }
  
  updateSubjectsPrinted();
  
  // Wait a bit for images to load
  await new Promise(resolve => setTimeout(resolve, 100));
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
  if (details) {
    tName.textContent = details.name || 'School Name';
    const address = [details.address, details.city, details.state, details.pincode].filter(Boolean).join(', ');
    if (tAddr) tAddr.textContent = address || '-';
    if (details.logo_url) tLogo.src = details.logo_url; else tLogo.removeAttribute('src');
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

async function fetchFatherName(studentId) {
  try {
    const { data } = await supabaseClient
      .from('parents')
      .select('name')
      .eq('tenant_id', TENANT_ID)
      .eq('student_id', studentId)
      .eq('relation', 'Father')
      .maybeSingle();
    return data?.name || '-';
  } catch (_) {
    return '-';
  }
}

async function fetchStudentPhotoUrl(studentId) {
  try {
    const { data } = await supabaseClient
      .from('users')
      .select('profile_url')
      .eq('tenant_id', TENANT_ID)
      .eq('linked_student_id', studentId)
      .maybeSingle();
    return data?.profile_url || '';
  } catch (_) {
    return '';
  }
}

function updateSubjectsPrinted() {
  const tbody = el('#tSubjectsTableBody');
  if (!tbody) return;
  const rows = Array.from(document.querySelectorAll('#subjectsBody .subject-section'));
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">No subjects registered</td></tr>';
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
    const time = from && to ? `${from} - ${to}` : (from || to);
    return `<tr><td>${escapeHtml(date)}</td><td>${escapeHtml(time)}</td><td>${escapeHtml(name)}</td></tr>`;
  }).join('');
  tbody.innerHTML = html || '<tr><td colspan="3" class="empty">No subjects registered</td></tr>';
}

function populateTicketStudentInfo(student, classLabel, examName) {
  el('#tStudentName').textContent = student.name || '-';
  el('#tAdmissionNo').textContent = student.admission_no || '-';
  el('#tRollNo').textContent = (student.roll_no ?? '-');
  const tClass = el('#tClass'); if (tClass) tClass.textContent = classLabel || '-';
  el('#tExam').textContent = examName || '-';
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
  const pEl = el('#tPhoto'); if (pEl) { if (photoUrl) pEl.src = photoUrl; else pEl.removeAttribute('src'); }
  
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
  // Return the element to render as PDF
  return document.getElementById('ticketArea');
}

async function downloadTicketAsPdf() {
  const { jsPDF } = window.jspdf;
  const el = getTicketHtmlForPdf();
  updateSubjectsPrinted();
  el.classList.add('pdf-mode');
  const canvas = await html2canvas(el, { scale: 2 });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Fit image to page width
  const imgWidth = pageWidth;
  const imgHeight = canvas.height * (imgWidth / canvas.width);
  let y = 0;
  if (imgHeight > pageHeight) {
    // If content taller than page, scale to height instead
    const ratio = pageHeight / imgHeight;
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth * ratio, pageHeight);
  } else {
    pdf.addImage(imgData, 'PNG', 0, y, imgWidth, imgHeight);
  }
  
  // Generate filename
  const studentName = (selectedStudent?.name || 'ticket').replace(/[^a-z0-9_-]/gi, '_');
  const filename = `${studentName}_hall_ticket.pdf`;
  
  pdf.save(filename);
  el.classList.remove('pdf-mode');
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