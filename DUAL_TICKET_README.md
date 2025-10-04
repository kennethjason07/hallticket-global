# Dual Hall Ticket Feature

## Overview
This updated hall ticket system now supports generating two different student hall tickets on the same page, similar to the format shown in your reference image.

## New Features

### 1. Dual Ticket Layout
- Two hall tickets are displayed side by side on one page
- Each ticket has its own student information and photo
- Follows the GURU NANAK DEV ENGINEERING COLLEGE format
- Includes 5-column subject table (Date, Time, Subject Name, Subject Code, Sign)
- Three signature sections: Candidate, HOD, and Principal

### 2. Student Selection Interface
- After designing the ticket template, you can select two different students
- Dropdown menus for Student 1 and Student 2 selection
- Prevents selecting the same student twice
- Generates dual tickets with one button click

### 3. Enhanced PDF Generation
- PDF captures both tickets on a single page
- Filename includes both student names
- Optimized for A4 printing

## How to Use

1. **Select Class**: Choose a class from the dropdown
2. **Design Template**: Add subjects and exam details
3. **Complete Design**: Click "Design Complete - Show Students"
4. **Select Students**: Choose two different students from the dropdowns
5. **Generate**: Click "Generate Dual Ticket" to create the dual layout
6. **Print/Download**: Use the Print or Download PDF buttons

## File Changes Made

### HTML (index.html)
- Added dual ticket structure with ticket1 and ticket2 sections
- Updated table structure to 5 columns (Date, Time, Subject Name, Subject Code, Sign)
- Added student selection interface with dropdowns
- Updated header format to match college template

### CSS (styles.css)
- Added dual-mode layout styles for side-by-side tickets
- Each ticket takes 48% width with 15px gap
- Added styles for student selection interface
- Added three-signature layout support
- Added print media queries for proper PDF output

### JavaScript (app.js)
- Added dual ticket mode variables and functions
- Enhanced subject table population for 5-column format
- Added student dropdown population
- Added dual ticket generation logic
- Updated PDF generation to handle dual tickets
- Added proper filename generation for dual tickets

## Technical Details

- Maintains backward compatibility with single ticket mode
- Uses flexbox layout for responsive dual ticket display
- Generates subject codes dynamically
- Supports different student photos for each ticket
- Preserves all existing functionality

## Testing

To test the dual ticket functionality:
1. Ensure your database has multiple students in a class
2. Follow the usage steps above
3. Verify both tickets display different student information
4. Test PDF generation and printing

The system now perfectly matches the format shown in your reference image with two tickets per page!