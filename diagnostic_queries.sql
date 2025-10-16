-- Diagnostic SQL queries to check student photo issues
-- Use these in your database client (like pgAdmin, Supabase Dashboard, etc.)

-- 1. Check total students in the tenant
SELECT 
    COUNT(*) as total_students,
    COUNT(DISTINCT class_id) as classes_count
FROM students 
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

-- 2. Check how many users are linked to students
SELECT 
    COUNT(DISTINCT s.id) as total_students,
    COUNT(DISTINCT u.linked_student_id) as students_with_linked_users,
    COUNT(CASE WHEN u.profile_url IS NOT NULL AND u.profile_url != '' THEN 1 END) as students_with_photos,
    ROUND(
        (COUNT(CASE WHEN u.profile_url IS NOT NULL AND u.profile_url != '' THEN 1 END) * 100.0) / 
        COUNT(DISTINCT s.id), 2
    ) as photo_coverage_percentage
FROM students s
LEFT JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a';

-- 3. List students without linked user accounts
SELECT 
    s.id,
    s.name,
    s.admission_no,
    s.roll_no,
    c.class_name,
    c.section
FROM students s
LEFT JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
LEFT JOIN classes c ON c.id = s.class_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND u.linked_student_id IS NULL
ORDER BY c.class_name, c.section, s.roll_no;

-- 4. List students with linked users but no profile photo
SELECT 
    s.id,
    s.name,
    s.admission_no,
    s.roll_no,
    c.class_name,
    c.section,
    u.id as user_id,
    u.profile_url
FROM students s
INNER JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
LEFT JOIN classes c ON c.id = s.class_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND (u.profile_url IS NULL OR u.profile_url = '')
ORDER BY c.class_name, c.section, s.roll_no;

-- 5. List students with profile photos (to verify URLs)
SELECT 
    s.id,
    s.name,
    s.admission_no,
    s.roll_no,
    c.class_name,
    c.section,
    u.profile_url
FROM students s
INNER JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
LEFT JOIN classes c ON c.id = s.class_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND u.profile_url IS NOT NULL 
    AND u.profile_url != ''
ORDER BY c.class_name, c.section, s.roll_no
LIMIT 10;

-- 6. Get a sample class for testing
SELECT 
    c.id as class_id,
    c.class_name,
    c.section,
    COUNT(s.id) as student_count,
    COUNT(u.linked_student_id) as students_with_users,
    COUNT(CASE WHEN u.profile_url IS NOT NULL AND u.profile_url != '' THEN 1 END) as students_with_photos
FROM classes c
LEFT JOIN students s ON s.class_id = c.id AND s.tenant_id = c.tenant_id
LEFT JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
WHERE c.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
GROUP BY c.id, c.class_name, c.section
HAVING COUNT(s.id) > 0
ORDER BY COUNT(s.id) DESC
LIMIT 5;

-- 7. Check for duplicate linked_student_id entries (data integrity issue)
SELECT 
    linked_student_id,
    COUNT(*) as user_count
FROM users 
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND linked_student_id IS NOT NULL
GROUP BY linked_student_id
HAVING COUNT(*) > 1;

-- 8. Sample a few URLs to manually test accessibility
SELECT 
    s.name,
    u.profile_url,
    LENGTH(u.profile_url) as url_length
FROM students s
INNER JOIN users u ON u.linked_student_id = s.id AND u.tenant_id = s.tenant_id
WHERE s.tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
    AND u.profile_url IS NOT NULL 
    AND u.profile_url != ''
ORDER BY RANDOM()
LIMIT 5;