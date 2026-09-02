White Glove Therapy — Netlify upload folder
==========================================

1. Open config.js and replace PASTE_YOUR_TmsApiUrl_HERE with your AWS TmsApiUrl
   (from: npm run cdk -w @white-glove/infra -- deploy)

2. In Netlify: Add new site -> Deploy manually -> drag THIS FOLDER onto the page.

3. Open the Netlify site URL. Use the role dropdown (therapist / admin) to test.

API stays on White Glove AWS. This folder is only the static UI.

To rebuild this folder from source:
  npm run tms:netlify
  TMS_API_URL=https://... npm run tms:netlify
