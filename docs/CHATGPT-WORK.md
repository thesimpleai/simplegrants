# Connect Simple Grants to ChatGPT Work

Use a private pilot to connect ChatGPT Work to one Simple Grants organisation. Work can read the organisation profile, review available document text, and look up grants and applications. It can save reviewed text as a source note, add an unverified grant, and save application text as a draft. Submission stays with the applicant in the funder's portal.

## 1. Prepare a private pilot

Use a test organisation and sample records for the first connection. Confirm that your ChatGPT workspace allows custom MCP plugins. If a permission is missing, ask the workspace administrator to enable it for the pilot group. Skill uploads have their own permission. [ChatGPT plugin permissions](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors) · [ChatGPT skill permissions](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)

1. In the existing Simple Grants Supabase project's SQL Editor, apply the additive Work OAuth migration. The connector uses the existing Simple Grants sign-in and stores its connection records in the `simple_grant` schema. [Work OAuth migration](../supabase/migrations/20261127000100_work_oauth.sql) · [Shared-project deployment](DEPLOYMENT.md)
2. In Netlify's Functions environment, keep `AUTH_APP_URL` set to the canonical HTTPS origin of this installation, such as `https://simplegrants.com.au`. Set `WORK_MCP_ENABLED=true`. Set `WORK_OAUTH_CLIENT_ID` to an identifier you choose for this ChatGPT connection. Generate a random client secret with `openssl rand -hex 32` and store it in `WORK_OAUTH_CLIENT_SECRET`. Keep the secret in Netlify and the ChatGPT OAuth connection form.
3. Set `WORK_OAUTH_REDIRECT_URI` to the callback shown by ChatGPT. On first setup, use the documented stable callback `https://chatgpt.com/connector_platform_oauth_redirect` until you can confirm the value in ChatGPT. Deploy the revision that adds `/api/mcp`. [OAuth redirect URL](https://developers.openai.com/plugins/build/auth#redirect-url)
4. Open **Plugins → Add → Add custom MCP server** in ChatGPT. Enter **Simple Grants** and the canonical HTTPS URL ending in `/api/mcp`. Choose OAuth with a predefined client and enter the same client ID and secret. If asked for a scope, enter `simple-grants`. Both `client_secret_basic` and `client_secret_post` are supported.
5. Check the exact OAuth callback URL that ChatGPT shows for this connection. If the URL differs, update `WORK_OAUTH_REDIRECT_URI` in Netlify and redeploy. Finish creating and scanning the plugin in ChatGPT. Keep access limited to pilot participants. [Add a custom MCP server](https://developers.openai.com/plugins/deploy/connect-chatgpt)

If your workspace does not show **Add custom MCP server**, check the plan, workspace, and role with the workspace administrator. The Simple Grants web app remains available for the same records and draft workflow. [Custom MCP availability](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)

## 2. Connect your account and install the skill

1. Install and open the Simple Grants plugin in ChatGPT. Select **Connect** and sign in with your existing Simple Grants account in the browser that opened the connection.
2. Select the organisation you want ChatGPT to use and approve the connection. A connection covers one organisation. The permissions of your existing role apply. Viewers can read. Owners, admins, and members can read and save the supported records.
3. In ChatGPT, go to **Plugins → Skills → Create → Upload from your computer**. Upload `simple-grants-skill.zip` and install the skill when it is available. If your Work setup lacks skill upload, attach the skill instructions to the pilot task and ask Work to follow them. [Skill instructions](../skills/simple-grants/SKILL.md) · [Upload a ChatGPT skill](https://help.openai.com/en/articles/20001066-skills-in-chatgpt)
4. Start a new Work task, select **@Simple Grants**, and tell Work which organisation and grant you are working on. If you want to use a personal dot, first verify that the installed plugin and its tools are available in that dot's task. [Use a plugin in Work](https://learn.chatgpt.com/docs/build-plugins) · [Use connected apps with a dot](https://learn.chatgpt.com/docs/dots/computers-and-apps)

To rebuild the skill archive from the repository root, run `cd skills` and then `zip -X /absolute/path/simple-grants-skill.zip simple-grants/SKILL.md` with your chosen output path.

## 3. Read evidence and prepare a draft

Ask Work to start by confirming the connected organisation. Identify the grant and request a source-backed summary of the evidence available for it. Ask Work to name each source it used and flag gaps that affect eligibility or draft completeness.

For eligible documents already in Simple Grants, Work can use extracted text or text that Simple Grants can read directly. Open documents with unavailable text in the Simple Grants web app. Use that workflow for insurance and private financial records. For a new file, you can attach it to Work and ask for a summary or paste a relevant excerpt. Review that text before asking Work to save it as a source note. Upload original files in Simple Grants so the organisation retains them.

Ask Work to identify the funding body's official source before saving a grant. Check the title, funding body, deadline, and eligibility before treating the saved grant as verified. Ask Work to use the evidence and flag missing figures, unsupported claims, and questions for you. Review the proposed text, then ask Work to save it as a draft and open the saved record in Simple Grants. If someone edited the draft during your session, read the latest version before approving an update.

## 4. Verify the pilot before sharing access

1. **Sign-in and organisation.** Connect through the intended ChatGPT account and select the test organisation. Ask Work to name the connected organisation and list its saved grants. Compare both with the web app. Check that a request for records in another test organisation fails through this connection.
2. **Evidence.** Ask Work for the source of a known fact from a test document. Compare the fact and document reference with the source. Try a sample record with unavailable text and check that Work identifies the gap.
3. **Draft writes.** Use an owner or member account. Review a sample source note, an unverified grant, and a draft. Ask Work to save each and open the corresponding records in Simple Grants to compare their content and status. Check the plugin's tool list for draft-only application access.
4. **Viewer and disconnect.** Connect as a viewer of the test organisation and confirm the read works. Confirm that draft writes are denied. Disconnect the Work connection in the organisation's settings in Simple Grants. Start a fresh Work task and confirm it asks you to reconnect before reading more records.
5. **Release.** Check that Netlify is serving the intended revision at the canonical URL. Record the successful Work checks for the pilot account. Share with the next group only after these checks pass on the deployed version.

To stop the pilot for the site, set `WORK_MCP_ENABLED=false` in Netlify and redeploy. To end your own connection, disconnect it in the organisation settings in Simple Grants.
