# Student Photo Troubleshooting Guide

## Problem: Photos not appearing in hall ticket PDFs

This guide helps diagnose and fix issues with student photos not appearing in generated hall tickets.

## Quick Diagnosis

### Step 1: Run the Debug Tool
1. Open `debug.html` in your browser
2. Check the console output (F12) for detailed diagnostics
3. Look for error messages about database connections, missing photos, or CORS issues

### Step 2: Check Database
Run the SQL queries in `diagnostic_queries.sql` in your database client to check:
- How many students have linked user accounts
- How many have profile photo URLs
- Whether photo URLs are valid

## Common Issues & Solutions

### Issue 1: Students don't have linked user accounts
**Symptoms:** Console shows "No linked user found for student X"

**Solution:** Each student needs a corresponding user record with `linked_student_id` set to the student's ID.

```sql
-- Create user accounts for students without them
INSERT INTO users (tenant_id, linked_student_id, profile_url, email, name)
SELECT 
    s.tenant_id,
    s.id,
    NULL, -- Set profile_url later
    LOWER(s.name || '@school.edu'), -- Generate email
    s.name
FROM students s
LEFT JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND u.id IS NULL;
```

### Issue 2: Users exist but have no profile_url
**Symptoms:** Console shows "Found profile URL for student X: empty"

**Solution:** Update user records with photo URLs:

```sql
-- Update profile URLs for existing users
UPDATE users 
SET profile_url = 'https://example.com/photos/student_' || linked_student_id || '.jpg'
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND linked_student_id IS NOT NULL
    AND (profile_url IS NULL OR profile_url = '');
```

### Issue 3: Photo URLs are broken or inaccessible
**Symptoms:** Console shows "Photo failed to load: [URL]"

**Causes:**
- URLs point to non-existent files
- CORS restrictions on the image server
- Images are behind authentication
- Network connectivity issues

**Solutions:**
1. **Test URLs manually:** Copy URLs from database and open in browser
2. **Fix CORS:** Ensure image server allows cross-origin requests
3. **Use accessible storage:** Consider using cloud storage like AWS S3, Google Cloud, or Supabase Storage
4. **Update broken URLs:** Fix or replace invalid photo URLs

### Issue 4: CORS errors preventing image loading
**Symptoms:** Console shows CORS-related errors when loading images

**Solutions:**
1. **Use same-origin images:** Host photos on same domain as app
2. **Configure server CORS:** Add proper CORS headers to image server
3. **Use proxy:** Route image requests through your server
4. **Use data URLs:** Convert images to base64 data URLs (not recommended for large images)

### Issue 5: Images load too slowly for PDF generation
**Symptoms:** Photos appear in preview but not in PDF

**Solutions:**
1. **Increase timeout:** The app now uses 5-second timeout (increased from 800ms)
2. **Optimize images:** Compress/resize images for faster loading
3. **Preload images:** The enhanced version includes image preloading
4. **Use CDN:** Serve images from a fast CDN

## Enhanced Features

The updated app includes:

### Better Error Handling
- Detailed console logging for photo operations
- Enhanced error messages showing specific failure reasons
- Graceful fallbacks when photos fail to load

### Improved CORS Support
- Multiple CORS attribute settings
- Better handling of cross-origin images
- Enhanced error detection for CORS issues

### Longer Timeouts
- Increased image loading timeout from 800ms to 5 seconds
- Smarter waiting logic that doesn't block on failed images
- Progress logging for debugging

### Debug Tools
- `debug.html` - Interactive photo diagnostics
- `diagnostic_queries.sql` - Database analysis queries
- Enhanced console logging throughout the photo pipeline

## Testing Your Fix

1. **Use the debug tool:** Open `debug.html` to see photo accessibility
2. **Test individual tickets:** Generate a single student's hall ticket
3. **Test bulk generation:** Generate full class tickets
4. **Check console logs:** Monitor for any remaining errors
5. **Verify PDF output:** Ensure photos appear in downloaded PDFs

## Database Schema Requirements

Ensure your database has proper relationships:

```sql
-- Students table should have
students (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    class_id UUID NOT NULL,
    name TEXT NOT NULL,
    admission_no TEXT,
    roll_no INTEGER
);

-- Users table should have
users (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    linked_student_id UUID REFERENCES students(id),
    profile_url TEXT,
    email TEXT,
    name TEXT
);
```

## Best Practices

1. **Image Format:** Use JPEG or PNG formats
2. **Image Size:** Keep images under 500KB for faster loading
3. **Image Dimensions:** Recommended size: 300x400 pixels (passport photo ratio)
4. **Storage Location:** Use reliable cloud storage or CDN
5. **URL Structure:** Use consistent, predictable URL patterns
6. **Backup Plan:** Have default/placeholder images for missing photos

## Still Having Issues?

1. Check browser console for specific error messages
2. Verify database connectivity and credentials
3. Test image URLs manually in browser
4. Check network connectivity and firewall settings
5. Ensure image server has proper CORS configuration
6. Consider using same-origin images to avoid CORS entirely