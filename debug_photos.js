// Debug script to check student photos in database
'use strict';

const TENANT_ID = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

// Helper function to parse environment file
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
  const candidates = ['credentials.txt', 'credentials.txt.txt'];
  for (const path of candidates) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (res.ok) {
        const txt = await res.text();
        const env = parseEnv(txt);
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
  throw new Error('credentials file not found');
}

function createSbClient(url, anon) {
  const { createClient } = window.supabase;
  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { 'x-application-name': 'hallticket-debug' } },
  });
}

async function debugPhotos() {
  try {
    console.log('🔍 Starting photo debug...');
    
    // Load credentials
    const { url, anon } = await loadCredentials();
    const supabase = createSbClient(url, anon);
    console.log('✅ Connected to Supabase');

    // Get a sample of students
    console.log('📚 Fetching students...');
    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('id,name,admission_no')
      .eq('tenant_id', TENANT_ID)
      .limit(5);

    if (studentsError) {
      console.error('❌ Students fetch error:', studentsError);
      return;
    }

    console.log(`✅ Found ${students?.length || 0} students (showing first 5)`);

    // Check user linkage for these students
    console.log('🔗 Checking user linkage...');
    const studentIds = students?.map(s => s.id) || [];
    
    if (studentIds.length === 0) {
      console.log('⚠️ No students found');
      return;
    }

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('linked_student_id,profile_url')
      .eq('tenant_id', TENANT_ID)
      .in('linked_student_id', studentIds);

    if (usersError) {
      console.error('❌ Users fetch error:', usersError);
      return;
    }

    console.log(`✅ Found ${users?.length || 0} linked user accounts`);

    // Analyze the data
    console.log('\n📊 Analysis:');
    students?.forEach(student => {
      const linkedUser = users?.find(u => u.linked_student_id === student.id);
      console.log(`\n👤 ${student.name} (ID: ${student.id})`);
      console.log(`   Admission: ${student.admission_no}`);
      
      if (linkedUser) {
        console.log(`   ✅ Has linked user account`);
        if (linkedUser.profile_url) {
          console.log(`   📷 Profile URL: ${linkedUser.profile_url}`);
          // Test if URL is accessible
          testImageUrl(linkedUser.profile_url);
        } else {
          console.log(`   ❌ No profile_url set`);
        }
      } else {
        console.log(`   ❌ No linked user account`);
      }
    });

    // Summary stats
    const totalStudents = students?.length || 0;
    const linkedUsers = users?.length || 0;
    const usersWithPhotos = users?.filter(u => u.profile_url).length || 0;

    console.log(`\n📈 Summary:`);
    console.log(`   Total students checked: ${totalStudents}`);
    console.log(`   Students with linked accounts: ${linkedUsers}`);
    console.log(`   Accounts with photos: ${usersWithPhotos}`);
    console.log(`   Photo coverage: ${totalStudents ? Math.round((usersWithPhotos / totalStudents) * 100) : 0}%`);

  } catch (error) {
    console.error('💥 Debug failed:', error);
  }
}

function testImageUrl(url) {
  const img = new Image();
  img.onload = function() {
    console.log(`   ✅ Image loads successfully (${this.width}x${this.height})`);
  };
  img.onerror = function() {
    console.log(`   ❌ Image failed to load`);
  };
  img.crossOrigin = 'anonymous';
  img.src = url;
}

// Run debug when page loads
document.addEventListener('DOMContentLoaded', debugPhotos);