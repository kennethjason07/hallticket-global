-- Add placeholder photos to students table
-- Run this in your database client (Supabase Dashboard, etc.)

-- Check current photo status
SELECT 
    COUNT(*) as total_students,
    COUNT(CASE WHEN photo_url IS NOT NULL AND photo_url != '' THEN 1 END) as students_with_photos,
    ROUND(
        (COUNT(CASE WHEN photo_url IS NOT NULL AND photo_url != '' THEN 1 END) * 100.0) / COUNT(*), 2
    ) as photo_coverage_percentage
FROM students 
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

-- Add placeholder photos for students without them
UPDATE students 
SET photo_url = 'https://via.placeholder.com/300x400/cccccc/666666?text=Student+Photo'
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND (photo_url IS NULL OR photo_url = '');

-- Verify the update
SELECT 
    COUNT(*) as total_students,
    COUNT(CASE WHEN photo_url IS NOT NULL AND photo_url != '' THEN 1 END) as students_with_photos,
    'All students now have photos!' as status
FROM students 
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

-- Sample a few students to check their photo URLs
SELECT 
    name,
    admission_no,
    photo_url
FROM students 
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
LIMIT 5;