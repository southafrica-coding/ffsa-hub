import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

// The approved version of a legal draft, as stored in its folder. Letters
// print as written; forms print field by field, missing ones marked so the
// paper can't be mistaken for complete. The footer records who approved it
// in the Hub and when.

type Field = { label: string; value: string; source: string; missing: boolean };

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 64, paddingHorizontal: 52, fontSize: 11, fontFamily: "Helvetica", color: "#0A0A0A", lineHeight: 1.5 },
  kicker: { fontSize: 8, color: "#55524A", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 18 },
  para: { marginBottom: 9 },
  fieldRow: { flexDirection: "row", borderBottom: "1px solid #DEDACE", paddingVertical: 5 },
  fieldLabel: { width: "42%", paddingRight: 10, color: "#3A3833" },
  fieldValue: { width: "58%" },
  missing: { color: "#B42318", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 28, left: 52, right: 52, fontSize: 8, color: "#7C786C", borderTop: "1px solid #DEDACE", paddingTop: 6 },
});

function DraftDocument(args: { title: string; kind: string; body: string; fields: Field[]; approvedBy: string; approvedOn: string }) {
  const paragraphs = args.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <Document title={args.title} author="Fire and Fragrance South Africa">
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>Fire and Fragrance South Africa</Text>
        <Text style={styles.title}>{args.title}</Text>
        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.para}>{p}</Text>
        ))}
        {args.fields.length > 0 && (
          <View style={{ marginTop: paragraphs.length ? 10 : 0 }}>
            {args.fields.map((f, i) => (
              <View key={i} style={styles.fieldRow} wrap={false}>
                <Text style={styles.fieldLabel}>{f.label}</Text>
                <Text style={[styles.fieldValue, ...(f.missing || !f.value ? [styles.missing] : [])]}>
                  {f.missing || !f.value ? "MISSING — to be completed" : f.value}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Approved by ${args.approvedBy} on ${args.approvedOn} in the FFSA Hub · page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export function renderDraftPdf(args: Parameters<typeof DraftDocument>[0]): Promise<Buffer> {
  return renderToBuffer(<DraftDocument {...args} />);
}
