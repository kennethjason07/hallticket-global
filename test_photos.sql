-- Quick test: Check if students have photo_url values
SELECT 
    id,
    name,
    admission_no,
    CASE 
        WHEN photo_url IS NULL THEN 'NO PHOTO URL'
        WHEN photo_url = '' THEN 'EMPTY PHOTO URL'
        ELSE 'HAS PHOTO URL'
    END as photo_status,
    photo_url
FROM students 
WHERE tenant_id = '9abe534f-1a12-474c-a387-f8795ad3ab5a'
ORDER BY name
LIMIT 10;