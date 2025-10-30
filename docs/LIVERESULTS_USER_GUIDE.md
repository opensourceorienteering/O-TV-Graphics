# 📡 LiveResults Integration - User Guide

**TV-Grafik LiveResults Integration**  
**Version**: 1.0.0  
**Last Updated**: 2025-10-17

---

## 📋 Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Setting Up a Project](#setting-up-a-project)
4. [Creating Graphics with LiveResults Data](#creating-graphics-with-liveresults-data)
5. [Auto-Fill Feature](#auto-fill-feature)
6. [Advanced Features](#advanced-features)
7. [Troubleshooting](#troubleshooting)

---

## 🎯 Introduction

The LiveResults integration allows TV-Grafik to automatically populate broadcast graphics with live orienteering competition data from the Swedish LiveResults API. This eliminates manual data entry and ensures your graphics always display accurate, up-to-date information.

### **Key Benefits**:
- ✅ **No Manual Data Entry** - Automatically fetch competitor names, times, splits, and results
- ✅ **Real-Time Updates** - Graphics stay synchronized with live competition data
- ✅ **Error-Free** - Eliminate typos and data entry mistakes
- ✅ **Time-Saving** - Create professional graphics in seconds, not minutes
- ✅ **Professional Quality** - Consistent formatting and presentation

---

## 🚀 Getting Started

### **Prerequisites**:
1. TV-Grafik installed and running
2. Internet connection (to access LiveResults API)
3. A project created in TV-Grafik
4. At least one rundown in your project

### **Supported Templates**:
TV-Grafik includes 18 professional orienteering graphics templates:

**General Templates**:
- Lower Third (General)

**Individual Competition Templates**:
- Start List (Individual)
- Lower Third (Runner - Individual)
- Results List (Individual - Finish)
- Results List (Individual - Control)
- Split Times (Individual - Leader + Recent)
- Split Times (Individual - Runner Focus)

**Relay Competition Templates**:
- Start List (Relay)
- Lower Third (Team - Relay)
- Lower Third (Runner - Relay)
- Results List (Relay - Team Finish)
- Results List (Relay - Leg)
- Results List (Relay - Leg + Control)
- Split Times (Relay - Leader + Recent)
- Split Times (Relay - Runner Focus)

---

## 🏗️ Setting Up a Project

### **Step 1: Configure Project-Level Competition**

Setting a default competition for your project makes it easier to create multiple graphics for the same event.

1. **Open Your Project**
   - Click on your project in the left sidebar
   - Your rundowns will appear in the middle panel

2. **Open Project Settings**
   - Click the **Settings** button (⚙️) in the Rundowns panel header
   - The Project Settings modal will open

3. **Select Competition**
   - In the "LiveResults Integration" section, you'll see a list of available competitions
   - Scroll through the list or use the search feature
   - Click on your competition to select it
   - The selected competition will be highlighted with a checkmark (✓)

4. **Refresh Competitions** (Optional)
   - Click the **Refresh** button to reload the competition list from LiveResults
   - Useful if a new competition was just added

5. **Clear Selection** (Optional)
   - Click **Clear Selection** to remove the project-level competition
   - Items will need to specify their own competition

6. **Close Settings**
   - Click **Close** to save and exit
   - Your selection is automatically saved to the project

**💡 Tip**: Setting a project-level competition is recommended when all your graphics are for the same event. Individual items will inherit this competition automatically.

---

## 🎨 Creating Graphics with LiveResults Data

### **Step 2: Add a Template to Your Rundown**

1. **Select Your Rundown**
   - Click on a rundown in the middle panel
   - The rundown items will appear on the right

2. **Add New Item**
   - Click the **+** button or press **Ctrl+N**
   - Select a template from the dropdown
   - Click **Add**

3. **Edit the Item**
   - Click the **Edit** button (✏️) or press **Enter**
   - The item editor will open on the right side

### **Step 3: Configure LiveResults Integration**

In the item editor, you'll see a **LiveResults Integration** section at the top:

#### **Competition Selection**:
- **Option 1: Use Project Competition** (Recommended)
  - If you set a project-level competition, it will be used automatically
  - The dropdown will show "-- Use Project Competition --"
  - Below, you'll see: "Using: [Competition Name]"

- **Option 2: Override Competition**
  - Select a different competition from the dropdown
  - This overrides the project-level competition for this item only
  - Useful for multi-event broadcasts

#### **Class Selection**:
- Once a competition is selected (project or item-level), the Class dropdown appears
- Select the competition class (e.g., "M21", "W21", "H10")
- The class list is automatically loaded from the selected competition

### **Step 4: Auto-Fill Template Fields**

Once you've selected both a competition and a class, the magic happens:

1. **Click the Auto-Fill Button** (✨)
   - Located in the template field editor header
   - Only appears when competition + class are selected

2. **Wait for Data Loading**
   - The button will show a spinner while fetching data
   - Usually takes 1-2 seconds

3. **Review Auto-Filled Data**
   - All template fields are automatically populated
   - Data is mapped intelligently based on template type
   - Examples:
     - **Start List**: All runners with bib numbers and start times
     - **Results**: Top finishers with times and positions
     - **Split Times**: Leader and recent passings at control points

4. **Customize if Needed**
   - You can modify any auto-filled field
   - Useful for highlighting specific runners or adjusting display

5. **Save the Item**
   - Click **Save** or press **Ctrl+S**
   - Your LiveResults configuration is saved with the item

---

## ✨ Auto-Fill Feature

### **How Auto-Fill Works**

The auto-fill feature uses intelligent data mapping to populate template fields based on:
- **Template Type**: Different templates need different data
- **Competition Data**: Event name, date, organizer
- **Class Results**: Runners, times, positions, splits
- **Template Schema**: Field types and requirements

### **Auto-Fill Examples**

#### **Example 1: Start List (Individual)**
**Auto-Filled Fields**:
- `competitionName`: "Swedish Championships 2025"
- `className`: "M21"
- `runners`: Array of 20 runners with:
  - `position`: 1, 2, 3, ...
  - `bib`: "101", "102", "103", ...
  - `name`: "John Doe", "Jane Smith", ...
  - `club`: "OK Linné", "IFK Göteborg", ...
  - `startTime`: "10:00:00", "10:01:00", ...

#### **Example 2: Results List (Individual - Finish)**
**Auto-Filled Fields**:
- `competitionName`: "Swedish Championships 2025"
- `className`: "M21"
- `results`: Array of top 10 finishers with:
  - `position`: 1, 2, 3, ...
  - `bib`: "101", "102", "103", ...
  - `name`: "John Doe", "Jane Smith", ...
  - `club`: "OK Linné", "IFK Göteborg", ...
  - `time`: "45:23", "46:15", "47:02", ...
  - `diff`: "+0:00", "+0:52", "+1:39", ...

#### **Example 3: Split Times (Individual - Leader + Recent)**
**Auto-Filled Fields**:
- `competitionName`: "Swedish Championships 2025"
- `className`: "M21"
- `controlCode`: "151"
- `leader`: Object with:
  - `position`: 1
  - `name`: "John Doe"
  - `club`: "OK Linné"
  - `time`: "12:34"
- `recentPassings`: Array of 6 most recent runners at control

### **Auto-Fill Error Handling**

If auto-fill fails, you'll see an error message:
- **"Competition and class must be selected"** - Select both before clicking auto-fill
- **"Failed to fetch competition data"** - Check internet connection
- **"Failed to fetch class results"** - Class may not have results yet
- **"Auto-fill failed"** - Generic error, try refreshing and retrying

---

## 🔧 Advanced Features

### **Item-Level Competition Override**

Use this when broadcasting multiple events simultaneously:

1. Set project-level competition to your main event
2. For items from other events:
   - Edit the item
   - Select a different competition from the dropdown
   - Select the class
   - Auto-fill as normal
3. The item will use its own competition, not the project default

### **Manual Field Editing**

Even with auto-fill, you can manually edit any field:
- **Highlight Specific Runners**: Remove others from the list
- **Adjust Display Order**: Reorder runners manually
- **Add Custom Text**: Modify names, clubs, or other text
- **Override Times**: Correct errors or add manual times

### **Inheritance Indicators**

The UI shows when values are inherited:
- **"-- Use Project Competition --"** in dropdown = Using project competition
- **"Using: [Competition Name]"** below dropdown = Inherited value displayed
- Selecting a specific competition overrides the inheritance

---

## 🐛 Troubleshooting

### **Problem: Auto-Fill Button Not Appearing**

**Cause**: Competition or class not selected  
**Solution**: 
1. Ensure a competition is selected (project or item-level)
2. Ensure a class is selected
3. Both must be set for auto-fill to be enabled

### **Problem: Competition List is Empty**

**Cause**: Failed to fetch competitions from LiveResults API  
**Solution**:
1. Check internet connection
2. Click the Refresh button in Competition Selector
3. Check if LiveResults API is accessible: https://liveresultat.orientering.se

### **Problem: Class List is Empty**

**Cause**: Selected competition has no classes yet  
**Solution**:
1. Verify the competition has started
2. Try a different competition
3. Click Refresh to reload classes

### **Problem: Auto-Fill Returns No Data**

**Cause**: Class has no results yet  
**Solution**:
1. Wait for competition to start
2. Check if runners have started/finished
3. Try a different class with results

### **Problem: Auto-Filled Data is Incorrect**

**Cause**: Template type mismatch or data mapping issue  
**Solution**:
1. Verify you selected the correct template type
2. Manually edit the fields to correct
3. Report the issue for investigation

### **Problem: Changes Not Saving**

**Cause**: Forgot to click Save button  
**Solution**:
1. Always click **Save** after editing
2. Or press **Ctrl+S** to save quickly
3. Look for the success indicator

---

## 📞 Support

### **Getting Help**:
- Check this user guide first
- Review the Phase 3 completion document
- Check application logs in the LOG directory
- Report issues with detailed steps to reproduce

### **Useful Information for Support**:
- TV-Grafik version
- Operating system
- Competition ID and name
- Class name
- Template being used
- Error messages (exact text)
- Screenshots of the issue

---

## 🎉 Tips for Best Results

1. **Set Project Competition Early** - Configure it when creating the project
2. **Use Auto-Fill Liberally** - It's fast and accurate
3. **Review Before Broadcasting** - Always preview graphics before going live
4. **Save Frequently** - Use Ctrl+S to save your work
5. **Test with Sample Data** - Try auto-fill with a completed competition first
6. **Keep Templates Organized** - Use descriptive rundown names
7. **Leverage Inheritance** - Use project-level competition for single-event broadcasts

---

**Happy Broadcasting!** 🎬📡

