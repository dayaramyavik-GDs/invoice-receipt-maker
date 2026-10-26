# Setup guides for the remaining release work

These steps need your own accounts or keys, so they can't be automated from the repository.
Never paste passwords, tokens or connection strings into chats, issues or commits. Put them only in the
gitignored files named below, or in GitHub's secret settings.

## MongoDB Atlas (issue #20)

1. Sign up at <https://www.mongodb.com/cloud/atlas/register> (free; you can sign in with Google or GitHub).
2. **Create a cluster:** choose **M0 Free**. For the provider/region, pick one near where your API will run
   (e.g. AWS London `eu-west-2`). Name it `invoice-maker`.
3. **Database Access → Add New Database User:**
   - Authentication: password. Use **Autogenerate Secure Password** and save it in your password manager.
   - Username: `invoice_api`.
   - Built-in role: **Read and write to any database** (or, under *Specific Privileges*, `readWrite` on
     `invoice_maker` only, which is better).
4. **Network Access → Add IP Address:**
   - For testing from your PC: **Add Current IP Address**.
   - Later, add the outbound IP of your Kubernetes cluster (#19). Avoid `0.0.0.0/0` (anywhere).
5. **Connect → Drivers → Node.js** and copy the connection string. It looks like
   `mongodb+srv://invoice_api:<password>@invoice-maker.xxxxx.mongodb.net/?retryWrites=true&w=majority`.
   Insert the database name before the `?`:
   `...mongodb.net/invoice_maker?retryWrites=true&w=majority`.
   If the password contains special characters, URL-encode them.
6. **Test from your PC with the production Docker image:**
   - Create `backend/.env.production` (gitignored) containing:
     ```dotenv
     NODE_ENV=production
     PORT=3000
     MONGODB_URI=<the connection string from step 5>
     JWT_ACCESS_SECRET=<new random value>
     JWT_REFRESH_SECRET=<another new random value>
     CORS_ORIGINS=https://localhost
     ```
     Generate each secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
     Don't reuse the development secrets.
   - Run `docker compose -f docker-compose.prod.yml up --build`, then `curl.exe http://localhost:3000/health/ready`.
     Expected: `{"status":"ready"}`.
7. **For Kubernetes (#19):** put the same three secret values in `k8s/secrets/prod.env` (gitignored) and create
   the secret:
   `kubectl -n invoice-maker create secret generic invoice-api-secrets --from-env-file=k8s/secrets/prod.env`

**Troubleshooting:**
- `querySrv ENOTFOUND`: there's a typo in the cluster host.
- `bad auth`: wrong password, or special characters not URL-encoded.
- Timeout: your IP isn't in Network Access.

## Signed Android release (issue #21)

A signed build can be made now. It's offline-only until the API has a public HTTPS address (#19).

1. **Create your upload key (once).** Keep it outside the repo and back it up. If you lose it, you can't
   publish updates.
   ```powershell
   New-Item -ItemType Directory -Force C:\keys
   & "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot\bin\keytool.exe" -genkeypair -v -keystore C:\keys\invoice-maker-upload.jks -alias invoicemaker -keyalg RSA -keysize 2048 -validity 10000
   ```
   It asks for a keystore password and your name/organisation. Save the password in your password manager.
2. **Create `C:\keys\build.json`** (outside the repo):
   ```json
   {
     "android": {
       "release": {
         "keystore": "C:/keys/invoice-maker-upload.jks",
         "storePassword": "<your keystore password>",
         "alias": "invoicemaker",
         "password": "<your key password (same as keystore unless you chose a different one)>"
       }
     }
   }
   ```
3. **Set the API URL** (once #19 is done): put `"apiOrigin": "https://api.your-domain.com"` in
   `mobile-client/api.config.json`. Leave it empty for an offline-only build.
4. **Build** (in `mobile-client`, using JDK 17):
   ```powershell
   $env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot'
   cordova build android --release --buildConfig=C:\keys\build.json -- --packageType=apk      # to install directly
   cordova build android --release --buildConfig=C:\keys\build.json -- --packageType=bundle   # .aab for Google Play
   ```
   Output: `platforms\android\app\build\outputs\apk\release\app-release.apk` and `...\bundle\release\app-release.aab`.
5. **Install and smoke-test:**
   - Uninstall the debug build first, because the signatures differ.
   - `adb install platforms\android\app\build\outputs\apk\release\app-release.apk`
6. Attach the signed APK to a new GitHub release.

## Snyk scanning (issue #22)

1. Sign up at <https://snyk.io> (free; **Sign up with GitHub** is easiest).
2. In Snyk, open **Account settings** (your avatar) → **General** → **Auth Token** → click to reveal, and copy it.
3. In GitHub: **repository → Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `SNYK_TOKEN`
   - Secret: paste the token.
4. Re-run the latest **CI** workflow (Actions → CI → *Re-run all jobs*). The **snyk** job now runs
   `snyk test` and fails the build on high-severity issues.
