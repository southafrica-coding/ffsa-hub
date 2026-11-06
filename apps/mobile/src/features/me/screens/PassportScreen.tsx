// Me › Passport photo. The photo page of the person's passport, held once
// (web: PassportPhotoCard). GET/POST/DELETE /api/profile/passport-photo; the
// file is only reached through a signed URL the server mints.

import { View } from "react-native";

import { SectionBar } from "@/features/shell";

import { DocFile } from "../components/DocFile";
import { DocScreen, Intro, LoadGate, useLoad } from "../components/docs-ui";
import { getPassport } from "../docs-api";
import { formatDate } from "../docs-logic";
import { profileFetch } from "../http";
import { meStrings } from "../strings";

const d = meStrings.docs;
const s = d.passport;

export function PassportScreen() {
  const load = useLoad((signal) => getPassport(profileFetch, signal));
  const p = load.data;

  return (
    <DocScreen refreshing={load.refreshing} onRefresh={load.refresh}>
      <Intro>{s.intro}</Intro>
      <LoadGate load={load} loadingLabel={s.loading} errorTitle={s.loadErrorTitle} />

      {p ? (
        <View style={{ gap: 12 }}>
          <SectionBar label={s.fileLabel} />
          <DocFile
            kind="passport-photo"
            label={s.fileLabel}
            uploadName="passport.jpg"
            file={{ hasFile: p.has_file, fileName: p.file_name, signedUrl: p.signed_url }}
            meta={p.has_file && p.uploaded_at ? s.uploadedOn(formatDate(p.uploaded_at)) : undefined}
            onChange={(next) =>
              load.setData((prev) => ({
                ...prev,
                has_file: next.hasFile,
                file_name: next.fileName,
                signed_url: next.signedUrl,
                uploaded_at: next.hasFile ? new Date().toISOString() : null,
              }))
            }
          />
          <Intro>{s.tip}</Intro>
          <Intro>{d.privacyVehicles}</Intro>
        </View>
      ) : null}
    </DocScreen>
  );
}
