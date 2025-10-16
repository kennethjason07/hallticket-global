-- Alternative Solution: Add photos directly to students table
-- This avoids the need for user-student linking

-- Option 1: Add photo_url column to students table
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Update students with placeholder photos
UPDATE students 
SET photo_url = 'https://via.placeholder.com/300x400/cccccc/666666?text=Student+Photo'
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND photo_url IS NULL;

-- If you have actual photo URLs, update them like this:
-- UPDATE students 
-- SET photo_url = 'https://your-storage-domain.com/student-photos/' || id || '.jpg'
-- WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

-- Verify the update
SELECT 
    COUNT(*) as total_students,
    COUNT(CASE WHEN photo_url IS NOT NULL THEN 1 END) as students_with_photos,
    ROUND(
        (COUNT(CASE WHEN photo_url IS NOT NULL THEN 1 END) * 100.0) / COUNT(*), 2
    ) as photo_coverage_percentage
FROM students 
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a';