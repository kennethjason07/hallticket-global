// Enhanced photo handling functions
'use strict';

/**
 * Enhanced photo fetching with better error handling and logging
 */
async function fetchStudentPhotoUrlEnhanced(studentId) {
  console.log(`🔍 Fetching photo for student ID: ${studentId}`);
  
  if (photoUrlCache.has(studentId)) {
    const cachedUrl = photoUrlCache.get(studentId);
    console.log(`📋 Using cached photo URL: ${cachedUrl || 'empty'}`);
    return cachedUrl;
  }
  
  try {
    const { data, error } = await supabaseClient
      .from('users')
      .select('linked_student_id,profile_url')
      .eq('tenant_id', TENANT_ID)
      .eq('linked_student_id', studentId)
      .maybeSingle();
    
    if (error) {
      console.error(`❌ Database error fetching photo for student ${studentId}:`, error);
      photoUrlCache.set(studentId, '');
      return '';
    }
    
    if (!data) {
      console.log(`⚠️ No linked user found for student ${studentId}`);
      photoUrlCache.set(studentId, '');
      return '';
    }
    
    const url = data.profile_url || '';
    console.log(`📷 Found profile URL for student ${studentId}: ${url || 'empty'}`);
    
    photoUrlCache.set(studentId, url);
    return url;
    
  } catch (error) {
    console.error(`💥 Exception fetching photo for student ${studentId}:`, error);
    photoUrlCache.set(studentId, '');
    return '';
  }
}

/**
 * Enhanced photo setting with better error handling and CORS
 */
function setStudentPhotoEnhanced(photoUrl) {
  const pEl = document.querySelector('#tPhoto');
  const errEl = document.querySelector('#tPhotoError');
  
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
  
  // Set CORS attributes
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

/**
 * Enhanced image waiting with better timeout and error handling
 */
async function waitForImagesEnhanced(root, timeoutMs = 3000) {
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

/**
 * Test if an image URL is accessible
 */
function testImageAccessibility(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve({ success: false, error: 'No URL provided' });
      return;
    }
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = function() {
      resolve({
        success: true,
        width: this.naturalWidth,
        height: this.naturalHeight,
        url: url
      });
    };
    
    img.onerror = function(event) {
      resolve({
        success: false,
        error: 'Failed to load image',
        event: event,
        url: url
      });
    };
    
    img.src = url;
  });
}

/**
 * Enhanced PDF population with better photo handling
 */
async function populateTicketForPDFEnhanced(student, classLabel, examName) {
  console.log(`🎫 Populating ticket for ${student.name} (ID: ${student.id})`);
  
  // Set school header
  const details = await fetchSchoolDetails();
  setSchoolHeaderOnTicket(details);
  
  // Populate student info
  populateTicketStudentInfo(student, classLabel, examName);
  
  // Fetch father name and photo (use enhanced functions)
  const [fatherName, photoUrl] = await Promise.all([
    fetchFatherName(student.id),
    fetchStudentPhotoUrlEnhanced(student.id)
  ]);
  
  const fEl = document.querySelector('#tFatherName');
  if (fEl) fEl.textContent = fatherName || '-';
  
  // Set photo with enhanced handling
  setStudentPhotoEnhanced(photoUrl);
  
  // Update subjects
  updateSubjectsPrinted();
  
  // Wait for images with enhanced timeout
  await waitForImagesEnhanced(document.getElementById('originalTicket'), 5000);
  
  console.log(`✅ Ticket populated for ${student.name}`);
}

/**
 * Prefetch and validate photo URLs
 */
async function prefetchAndValidatePhotos(students) {
  console.log(`📸 Prefetching and validating photos for ${students.length} students...`);
  
  const photoPromises = students.map(async (student) => {
    const photoUrl = await fetchStudentPhotoUrlEnhanced(student.id);
    if (photoUrl) {
      const result = await testImageAccessibility(photoUrl);
      return {
        studentId: student.id,
        studentName: student.name,
        photoUrl,
        accessible: result.success,
        error: result.error,
        dimensions: result.success ? `${result.width}x${result.height}` : null
      };
    }
    return {
      studentId: student.id,
      studentName: student.name,
      photoUrl: null,
      accessible: false,
      error: 'No photo URL'
    };
  });
  
  const results = await Promise.all(photoPromises);
  
  // Log summary
  const withPhotos = results.filter(r => r.photoUrl);
  const accessible = results.filter(r => r.accessible);
  
  console.log(`📊 Photo validation summary:`);
  console.log(`   Total students: ${results.length}`);
  console.log(`   Students with photo URLs: ${withPhotos.length}`);
  console.log(`   Accessible photos: ${accessible.length}`);
  console.log(`   Photo accessibility rate: ${results.length ? Math.round((accessible.length / results.length) * 100) : 0}%`);
  
  // Log individual issues
  results.forEach(result => {
    if (!result.accessible) {
      console.log(`⚠️ ${result.studentName}: ${result.error}`);
    }
  });
  
  return results;
}

// Export enhanced functions for use in main app
window.enhancedPhotoFunctions = {
  fetchStudentPhotoUrlEnhanced,
  setStudentPhotoEnhanced,
  waitForImagesEnhanced,
  testImageAccessibility,
  populateTicketForPDFEnhanced,
  prefetchAndValidatePhotos
};