# FlowRecall - Project Handoff Document

## 1. Project Overview
**Name:** FlowRecall
**Type:** AI-Powered Educational SaaS (Flashcards & Study Tools)
**Live Domain:** `www.flowrecall.app`
**Current Workspace:** `/home/dizzyeyes/Desktop/Fri/` (Prototype) / `/home/dizzyeyes/Desktop/Flowrecall/` (Main App)

## 2. Business & Legal Status (Crucial Context)
*   **Company Structure:** Registered as a Sole Proprietorship (Vineesh Kumar S).
*   **DGFT / IEC Status:** Import Export Code (IEC) application has been 100% successfully submitted to the DGFT (₹500 paid, Aadhaar e-Signed). Currently awaiting the official IEC Certificate via email (expected in 1-3 days).
*   **Stripe Status:** Operating on invite-only in India. We replied to Stripe Sales (Imran) confirming we are 100% cross-border, registered, and will provide the IEC certificate once it arrives.

## 3. Go-To-Market & Payment Strategy
*   **Dual Payment Architecture ("God-Tier Setup"):**
    *   **Stripe:** Used exclusively for international users (USD/EUR, Credit Cards, Apple Pay).
    *   **Razorpay:** Used exclusively for Indian users (INR, UPI, Google Pay).
*   **Marketing Strategy:** Launching aggressively on TikTok. 
*   **Waitlist Hack:** While waiting for Stripe approval, the app will have a 1-deck limit. The "Upgrade to Pro" button will temporarily say **"Join the Pro Waitlist."** This builds hype and captures leads for a massive email blast when checkout goes live.

## 4. Current Engineering State & Technical Stack
*   **Current State:** The workspace (`/home/dizzyeyes/Desktop/Fri/`) currently contains an `index.html` file testing out an "Obsidian & Glowing Emerald" design palette.
*   **Tech Stack:** It is currently a pure HTML file utilizing the TailwindCSS CDN (`https://cdn.tailwindcss.com`). Custom colors (background, surface, primary emerald, etc.) are injected directly into the `<script>` tag configuration.
*   **Current UI:** The current UI has a basic dark-mode card layout with a gradient primary CTA ("Start Active Recall") and a secondary button ("Upload PDF"). 

## 5. Next Steps & Instructions for the AI
*   **Immediate Goal:** We have completely finished the legal/business roadblocks and are pivoting entirely back to coding the web app.
*   **Design Mandate:** The UI must be upgraded to a premium, modern aesthetic utilizing **glassmorphism**, dynamic hover effects, and a luxurious feel. The user is strictly requesting designs that are visually stunning and NOT basic/generic.
*   **First Task:** Please review `index.html` (in `/home/dizzyeyes/Desktop/Fri/`) to understand the current Emerald/Obsidian color tokens. Then, work with the user to either expand this into a full landing page or restructure it into a full framework (like Next.js/Vite) if they are ready to build out the React components for the SaaS.
