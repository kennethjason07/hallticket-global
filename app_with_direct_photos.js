// Alternative photo fetching function that gets photos directly from students table
// Replace the existing fetchStudentPhotoUrl function with this version

async function fetchStudentPhotoUrl(studentId) {
  console.log(`🔍 Fetching photo for student ID: ${studentId}`);
  
  if (photoUrlCache.has(studentId)) {
    const cachedUrl = photoUrlCache.get(studentId);
    console.log(`📋 Using cached photo URL: ${cachedUrl || 'empty'}`);
    return cachedUrl;
  }
  
  try {
    // First try to get photo from users table (existing approach)
    const { data: userData, error: userError } = await supabaseClient
      .from('users')
      .select('linked_student_id,profile_url')
      .eq('tenant_id', TENANT_ID)
      .eq('linked_student_id', studentId)
      .maybeSingle();
    
    if (!userError && userData && userData.profile_url) {
      console.log(`📷 Found profile URL from users table: ${userData.profile_url}`);
      photoUrlCache.set(studentId, userData.profile_url);
      return userData.profile_url;
    }
    
    // Fallback: Try to get photo directly from students table
    console.log(`🔄 Trying students table for photo...`);
    const { data: studentData, error: studentError } = await supabaseClient
      .from('students')
      .select('id,photo_url')
      .eq('tenant_id', TENANT_ID)
      .eq('id', studentId)
      .maybeSingle();
    
    if (studentError) {
      console.error(`❌ Database error fetching photo from students table:`, studentError);
      photoUrlCache.set(studentId, '');
      return '';
    }
    
    if (!studentData) {
      console.log(`⚠️ Student not found: ${studentId}`);
      photoUrlCache.set(studentId, '');
      return '';
    }
    
    const url = studentData.photo_url || '';
    console.log(`📷 Found photo URL from students table: ${url || 'empty'}`);
    
    photoUrlCache.set(studentId, url);
    return url;
    
  } catch (error) {
    console.error(`💥 Exception fetching photo for student ${studentId}:`, error);
    photoUrlCache.set(studentId, '');
    return '';
  }
}

// Also update the prefetchStudentMeta function to handle both approaches
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
    // Photos from users table
    const { data: photos } = await supabaseClient
      .from('users')
      .select('linked_student_id,profile_url')
      .eq('tenant_id', TENANT_ID)
      .in('linked_student_id', ids);
    if (Array.isArray(photos)) {
      for (const row of photos) {
        if (row.profile_url) {
          photoUrlCache.set(row.linked_student_id, row.profile_url);
        }
      }
    }
  } catch (_) {}
  
  try {
    // Photos from students table (fallback/alternative)
    const { data: studentPhotos } = await supabaseClient
      .from('students')
      .select('id,photo_url')
      .eq('tenant_id', TENANT_ID)
      .in('id', ids);
    if (Array.isArray(studentPhotos)) {
      for (const row of studentPhotos) {
        // Only cache if we don't already have a photo from users table
        if (row.photo_url && !photoUrlCache.has(row.id)) {
          photoUrlCache.set(row.id, row.photo_url);
        }
      }
    }
  } catch (_) {}
}