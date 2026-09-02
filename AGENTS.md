<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Releasing to Google Play

The Play upload is an **AAB**, not the APK that `public/flowrecall-release.apk` serves:

```bash
npm run build:apk && (cd android && ./gradlew bundleRelease)
# -> android/app/build/outputs/bundle/release/app-release.aab
```

**Bump `versionCode` in `android/app/build.gradle` for every upload.** Play rejects a second
upload carrying a `versionCode` it has already seen, and the failure arrives after the build.

**Play App Signing re-signs the app**, so the certificate Play distributes is Google's, not the
upload key `e1f4352f…bc09`. A student who sideloaded the direct-download APK therefore cannot
upgrade to the Play build in place — Android refuses a cert change, and uninstalling wipes the
on-device library. Sync restores it only if they signed in first, so say so wherever the APK is
offered.
