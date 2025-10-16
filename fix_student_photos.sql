-- Fix student photos by creating missing user accounts
-- Run this in your database client (Supabase Dashboard, pgAdmin, etc.)

-- First, let's see the current situation
SELECT 
    COUNT(DISTINCT s.id) as total_students,
    COUNT(DISTINCT u.linked_student_id) as students_with_users,
    COUNT(DISTINCT s.id) - COUNT(DISTINCT u.linked_student_id) as students_missing_users
FROM students s
LEFT JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

-- Create user accounts for all students that don't have them
INSERT INTO users (
    id,
    tenant_id,
    linked_student_id,
    email,
    name,
    profile_url,
    created_at,
    updated_at
)
SELECT 
    gen_random_uuid(), -- Generate new UUID for user
    s.tenant_id,
    s.id as linked_student_id,
    LOWER(REPLACE(s.name, ' ', '.')) || '@student.edu' as email, -- Generate email from name
    s.name,
    NULL as profile_url, -- Will be updated later with actual photo URLs
    NOW() as created_at,
    NOW() as updated_at
FROM students s
LEFT JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND u.id IS NULL; -- Only for students without user accounts

-- Verify the creation
SELECT 
    COUNT(DISTINCT s.id) as total_students,
    COUNT(DISTINCT u.linked_student_id) as students_with_users,
    'All students now have user accounts!' as status
FROM students s
LEFT JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

-- Optional: Update with sample photo URLs (replace with your actual photo URLs)
-- Uncomment and modify the following lines if you have photo URLs to add:

/*
-- Update with actual photo URLs (example pattern)
UPDATE users 
SET profile_url = 'https://your-storage-domain.com/student-photos/' || linked_student_id || '.jpg'
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND linked_student_id IS NOT NULL
    AND profile_url IS NULL;
*/

-- Or update with a default placeholder image
UPDATE users 
SET profile_url = 'https://via.placeholder.com/300x400/cccccc/666666?text=Student+Photo'
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND linked_student_id IS NOT NULL
    AND profile_url IS NULL;