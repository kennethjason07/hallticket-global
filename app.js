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
  // Show design completion button, hide print/download buttons
  el('#designComplete').classList.remove('hidden');
  el('#printTicket').classList.add('hidden');
  el('#downloadPdf').classList.add('hidden');
}

function setStudentModeUI() {
  // Hide design completion button, show print/download buttons
  el('#designComplete').classList.add('hidden');
  el('#printTicket').classList.remove('hidden');
  el('#downloadPdf').classList.remove('hidden');
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
  el('#tClass').textContent = classLabel || '-';
  el('#tExam').textContent = examName || 'Exam Name';

  // Reset subject rows with one default row
  clearSubjectsRows();
  addSubjectRow();

  // Set UI to design mode
  setDesignModeUI();
  openOverlay();
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
    tAddr.textContent = address || '-';
    if (details.logo_url) tLogo.src = details.logo_url; else tLogo.removeAttribute('src');
  }
}

function clearSubjectsRows() {
  el('#subjectsBody').innerHTML = '';
}

function addSubjectRow(prefillName = '') {
  const tbody = el('#subjectsBody');
  const rowIndex = tbody.children.length + 1;

  const tr = document.createElement('tr');
  tr.className = 'subject-row';
  tr.innerHTML = `
    <td>${rowIndex}</td>
    <td>
      <input class="subject-input" type="text" list="subjectsList" placeholder="Subject name" value="${escapeHtml(prefillName)}" />
    </td>
    <td>
      <input class="subject-input" type="date" />
    </td>
    <td>
      <input class="subject-input" type="time" step="60" placeholder="HH:MM" />
    </td>
  `;
  tbody.appendChild(tr);
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

function populateTicketStudentInfo(student, classLabel, examName) {
  el('#tStudentName').textContent = student.name || '-';
  el('#tAdmissionNo').textContent = student.admission_no || '-';
  el('#tRollNo').textContent = (student.roll_no ?? '-');
  el('#tClass').textContent = classLabel || '-';
  el('#tExam').textContent = examName || '-';
}

async function handleStudentClick(student) {
  selectedStudent = student;
  const classSel = el('#classSelect');
  const classLabel = classSel.options[classSel.selectedIndex]?.text || '';
  const examName = el('#examName').value.trim();

  // Set school header in the ticket area (in case changed)
  const details = await fetchSchoolDetails();
  setSchoolHeaderOnTicket(details);

  // Populate student header area
  populateTicketStudentInfo(student, classLabel, examName);

  // Keep existing subject rows from design phase
  // Only add a row if none exist
  if (el('#subjectsBody').children.length === 0) {
    addSubjectRow();
  }

  // Set UI to student mode
  setStudentModeUI();
  openOverlay();
}

async function handleDesignComplete() {
  if (!selectedClass) return;
  
  // Close the design overlay
  closeOverlay();
  
  // Load and display students for the selected class
  const students = await fetchStudentsByClass(selectedClass.id);
  renderStudentsGrid(students);
}

function getTicketHtmlForPdf() {
  // Return the element to render as PDF
  return document.getElementById('ticketArea');
}

async function downloadTicketAsPdf() {
  const { jsPDF } = window.jspdf;
  const el = getTicketHtmlForPdf();
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
  const studentName = (selectedStudent?.name || 'ticket').replace(/[^a-z0-9_-]/gi, '_');
  pdf.save(`${studentName}_hall_ticket.pdf`);
}

function printTicket() {
  window.print();
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
        renderStudentsGrid([]);
        return;
      }
      // Start hall ticket design phase instead of immediately showing students
      await startHallTicketDesign(selectedClass);
    });

    el('#addSubjectRow').addEventListener('click', () => addSubjectRow());
    el('#designComplete').addEventListener('click', handleDesignComplete);
    el('#closeOverlay').addEventListener('click', closeOverlay);
    el('#printTicket').addEventListener('click', printTicket);
    el('#downloadPdf').addEventListener('click', downloadTicketAsPdf);
  } catch (err) {
    alert(err.message || String(err));
  }
}

// Bootstrap after DOM is ready
document.addEventListener('DOMContentLoaded', init);