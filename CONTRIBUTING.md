# Contributing to WildTrail 🌿

Thank you for your interest in contributing to WildTrail! This project is participating in **Hacktoberfest 2026**.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/wildtrail.git
   cd wildtrail
   ```
3. **Run locally:**
   Because camera and location APIs require a secure context, start a local server:
   ```bash
   python3 -m http.server 8000
   ```
   Open `http://localhost:8000` in your browser.

## Ways to Contribute

* **New Species & Prompts:** Expand the offline candidate species array in `app.js` to recognize more birds, insects, flowers, and animals.
* **Trail & GIS Exports:** Help implement GPX / KML exports for hiker trail data.
* **UI/UX & Accessibility:** Improve contrast, responsive layouts on small screens, or add keyboard shortcuts.
* **Performance:** Optimize canvas rendering, battery usage on mobile GPS tracking, or asset caching in `sw.js`.

## Hacktoberfest 2026 Guidelines

* **Quality First:** We follow the official Hacktoberfest quality standards. Contributions must add genuine value.
* **No Spam:** Automated PRs, trivial typo fixes, or whitespace modifications will be labeled `invalid` or `spam`.
* **Testing:** Test your changes on both desktop and mobile viewports before submitting.
* **Commit Messages:** Write clear, concise commit messages explaining what you changed and why.

## Code of Conduct

Please be respectful, welcoming, and encouraging to fellow outdoor explorers and contributors.
