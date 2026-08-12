import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { WaiverSignatureRecord } from "@/lib/ticketing/waivers";

// A one-page "Signed Waiver Certificate" rendered at fulfilment for each
// attendee whose tier required a waiver. It records exactly what was
// agreed (title + version + document name), who signed (guardian +
// relationship), for whom (the minor/attendee), the typed signature, and
// an audit trail (timestamp + IP + ticket code). It's stored alongside the
// organizer's original blank form in the private waiver-documents bucket;
// together they constitute the signed record.

const styles = StyleSheet.create({
  page: {
    padding: 44,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
    lineHeight: 1.5,
  },
  header: {
    borderBottom: "2px solid #1a1a1a",
    paddingBottom: 12,
    marginBottom: 20,
  },
  kicker: {
    fontSize: 9,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
  },
  eventLine: {
    fontSize: 10,
    color: "#444",
    marginTop: 4,
  },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
    borderBottom: "1px solid #ccc",
    paddingBottom: 3,
  },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 150, color: "#666" },
  value: { flex: 1, fontFamily: "Helvetica-Bold" },
  signatureBox: {
    marginTop: 8,
    border: "1px solid #999",
    borderRadius: 4,
    padding: 14,
    backgroundColor: "#fafafa",
  },
  signatureName: {
    fontSize: 20,
    fontFamily: "Helvetica-Oblique",
  },
  signatureMeta: { fontSize: 8, color: "#777", marginTop: 6 },
  agreed: {
    marginTop: 10,
    fontSize: 10,
    color: "#1a5e2a",
    fontFamily: "Helvetica-Bold",
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 44,
    right: 44,
    fontSize: 7.5,
    color: "#999",
    borderTop: "1px solid #ddd",
    paddingTop: 8,
  },
});

export type WaiverCertificateArgs = {
  signature: WaiverSignatureRecord;
  eventTitle: string;
  tierName: string;
  ticketCode: string;
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-ZA", {
    dateStyle: "full",
    timeStyle: "short",
  });
}

export function WaiverCertificateDocument({
  signature,
  eventTitle,
  tierName,
  ticketCode,
}: WaiverCertificateArgs) {
  return (
    <Document
      title={`Signed ${signature.title} — ${eventTitle}`}
      author="FFSA Hub"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Signed Waiver Certificate</Text>
          <Text style={styles.title}>{signature.title}</Text>
          <Text style={styles.eventLine}>
            {eventTitle} · {tierName}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attendee</Text>
          {signature.minor_name ? (
            <View style={styles.row}>
              <Text style={styles.label}>Attendee / minor</Text>
              <Text style={styles.value}>{signature.minor_name}</Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.label}>Ticket code</Text>
            <Text style={styles.value}>{ticketCode}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Signed by parent / guardian</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Full name</Text>
            <Text style={styles.value}>{signature.guardian_name}</Text>
          </View>
          {signature.relationship ? (
            <View style={styles.row}>
              <Text style={styles.label}>Relationship to attendee</Text>
              <Text style={styles.value}>{signature.relationship}</Text>
            </View>
          ) : null}

          <View style={styles.signatureBox}>
            <Text style={styles.signatureName}>{signature.typed_signature}</Text>
            <Text style={styles.signatureMeta}>
              Typed electronic signature
            </Text>
            <Text style={styles.agreed}>
              ✓ Agreed to and signed the {signature.title} (version{" "}
              {signature.version})
              {signature.document_name
                ? ` — document: ${signature.document_name}`
                : ""}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Audit</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Signed at</Text>
            <Text style={styles.value}>{fmt(signature.signed_at)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>IP address</Text>
            <Text style={styles.value}>{signature.ip ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Form version</Text>
            <Text style={styles.value}>{signature.version}</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          This certificate was generated electronically by FFSA Hub at the time
          of ticket purchase and records the parent/guardian&apos;s agreement to
          the form named above. It should be retained alongside the original
          signed document.
        </Text>
      </Page>
    </Document>
  );
}
