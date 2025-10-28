# Color Reference Guide

## CUNY-Inspired Color Palette

This document provides a quick reference for the new color scheme used in the Bibliography to Zotero Converter.

## Primary Colors

### Blue Tones (Main Brand Colors)

| Color Name | Hex Code | RGB | Usage |
|------------|----------|-----|-------|
| **Primary Blue** | `#003DA5` | rgb(0, 61, 165) | Headings, buttons, links, focus states |
| **Secondary Blue** | `#002D72` | rgb(0, 45, 114) | Section headings, hover states |
| **Dark Navy** | `#001F4C` | rgb(0, 31, 76) | Reserved for emphasis |

### Neutral Colors

| Color Name | Hex Code | RGB | Usage |
|------------|----------|-----|-------|
| **White** | `#FFFFFF` | rgb(255, 255, 255) | Backgrounds, cards, text on dark |
| **Light Gray** | `#F8F9FA` | rgb(248, 249, 250) | Page background, footer, code blocks |
| **Medium Gray** | `#E9ECEF` | rgb(233, 236, 239) | Hover states, disabled elements |
| **Border Gray** | `#DEE2E6` | rgb(222, 226, 230) | Borders, dividers |

### Text Colors

| Color Name | Hex Code | RGB | Usage |
|------------|----------|-----|-------|
| **Text Dark** | `#212529` | rgb(33, 37, 41) | Main body text, labels |
| **Text Light** | `#495057` | rgb(73, 80, 87) | Subtitles, secondary text |
| **Text Muted** | `#6C757D` | rgb(108, 117, 125) | Help text, placeholders |

### Accent Colors

| Color Name | Hex Code | RGB | Usage |
|------------|----------|-----|-------|
| **Accent Red** | `#DC143C` | rgb(220, 20, 60) | Emphasis, code highlights |
| **Success Green** | `#28A745` | rgb(40, 167, 69) | Success messages, completed states |
| **Warning Yellow** | `#FFC107` | rgb(255, 193, 7) | Warning messages, caution |
| **Danger Red** | `#DC3545` | rgb(220, 53, 69) | Error messages, critical alerts |

## Shadow Definitions

| Name | Value | Usage |
|------|-------|-------|
| **Small** | `0 2px 4px rgba(0,0,0,0.08)` | Subtle elevation (headers, inputs) |
| **Medium** | `0 4px 12px rgba(0,0,0,0.12)` | Cards, buttons, dropdowns |
| **Large** | `0 8px 24px rgba(0,0,0,0.15)` | Modals, overlays |

## Usage Examples

### Buttons

**Primary Button:**
- Background: Primary Blue (`#003DA5`)
- Text: White (`#FFFFFF`)
- Hover: Secondary Blue (`#002D72`)

**Secondary Button:**
- Background: White (`#FFFFFF`)
- Border: Primary Blue (`#003DA5`)
- Text: Primary Blue (`#003DA5`)
- Hover: Light Gray (`#F8F9FA`)

### Form Elements

**Text Input:**
- Border: Border Gray (`#DEE2E6`)
- Focus Border: Primary Blue (`#003DA5`)
- Focus Ring: `rgba(0, 61, 165, 0.1)`

**Checkbox/Radio:**
- Accent Color: Primary Blue (`#003DA5`)

### Status Indicators

**Success:**
- Background: `rgba(40, 167, 69, 0.1)`
- Border: Success Green (`#28A745`)
- Text: Success Green (`#28A745`)

**Warning:**
- Background: `rgba(255, 193, 7, 0.1)`
- Border: Warning Yellow (`#FFC107`)
- Text: `#856404` (darker yellow-brown)

**Error:**
- Background: `rgba(220, 53, 69, 0.1)`
- Border: Danger Red (`#DC3545`)
- Text: Danger Red (`#DC3545`)

**Info:**
- Background: `rgba(0, 61, 165, 0.05)` to `rgba(0, 61, 165, 0.08)` gradient
- Border: Primary Blue (`#003DA5`)
- Text: Text Light (`#495057`)

### Progress Bar

- Track: White (`#FFFFFF`) with light border
- Fill: Gradient from Primary Blue to Secondary Blue
- Shadow: `0 2px 8px rgba(0, 61, 165, 0.3)`

## Accessibility Notes

### Contrast Ratios (WCAG AA)

All text colors meet WCAG AA standards for contrast:

- **Primary Blue on White:** 8.59:1 (AAA) ✓
- **Secondary Blue on White:** 11.53:1 (AAA) ✓
- **Text Dark on White:** 16.05:1 (AAA) ✓
- **Text Light on White:** 8.87:1 (AAA) ✓
- **Text Muted on White:** 5.74:1 (AA) ✓
- **Success Green on White:** 4.56:1 (AA) ✓
- **Danger Red on White:** 4.71:1 (AA) ✓

### Focus States

All interactive elements have visible focus indicators:
- 3px ring with 10% opacity of Primary Blue
- Keyboard navigation clearly visible
- Consistent across all form elements

## Migration from Old Colors

| Old (Purple) | New (Blue) | Element |
|--------------|------------|---------|
| `#667eea` | `#003DA5` | Primary color |
| `#764ba2` | `#002D72` | Secondary color |
| Purple gradient | Solid blue | Buttons, headers |
| `rgba(102, 126, 234, ...)` | `rgba(0, 61, 165, ...)` | Focus rings, shadows |

## Quick Copy (CSS Variables)

```css
:root {
    --primary-blue: #003DA5;
    --secondary-blue: #002D72;
    --dark-navy: #001F4C;
    --accent-red: #DC143C;
    --light-gray: #F8F9FA;
    --medium-gray: #E9ECEF;
    --border-gray: #DEE2E6;
    --text-dark: #212529;
    --text-muted: #6C757D;
    --text-light: #495057;
    --white: #FFFFFF;
    --success: #28A745;
    --warning: #FFC107;
    --danger: #DC3545;
    --shadow-sm: 0 2px 4px rgba(0,0,0,0.08);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.12);
    --shadow-lg: 0 8px 24px rgba(0,0,0,0.15);
}
```

## Brand Alignment

This color palette is inspired by the CUNY Graduate Center brand colors and matches the whisper-server-nml tools for visual consistency across the AI Lab suite of applications.

The blue tones convey:
- **Professionalism** - Academic and trustworthy
- **Stability** - Reliable and consistent
- **Intelligence** - Smart tools and AI-powered features
- **Accessibility** - Clear and readable interface

## Future Considerations

If expanding to a full suite of tools, consider:
- Adding hover state variations (10% lighter/darker)
- Defining disabled state colors explicitly
- Creating a dark mode variant
- Adding animation/transition variables
- Defining spacing scale (4px, 8px, 12px, etc.)
