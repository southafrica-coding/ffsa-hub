import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { SIGNATURE_MARK, letterParagraphs } from "./letters";

// One FFSA visa letter as a printable A4 page. The wording is legal's
// template, already filled in (passport number included) by the PDF
// route. Legal prints this, signs and stamps it by hand, and uploads the
// scan. The student's copy for checking carries a band saying it isn't
// valid yet.

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#0A0A0A",
    lineHeight: 1.45,
  },
  head: {
    borderBottom: "1.5px solid #0A0A0A",
    paddingBottom: 8,
    marginBottom: 22,
  },
  org: { fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 1.6 },
  check: {
    backgroundColor: "#FFB801",
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 18,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
  },
  para: { marginBottom: 9 },
  sign: { height: 84 },
  foot: {
    position: "absolute",
    bottom: 26,
    left: 56,
    right: 56,
    fontSize: 7.5,
    color: "#7C786C",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

export function VisaLetterDocument({
  text,
  reference,
  forChecking,
}: {
  /** The letter, every field filled in. */
  text: string;
  /** Short reference printed in the footer so a scan can be matched to its letter. */
  reference: string;
  /** The student's copy: marked as not yet valid. */
  forChecking: boolean;
}) {
  return (
    <Document title="FFSA letter" author="Fire and Fragrance South Africa">
      <Page size="A4" style={styles.page}>
        <View style={styles.head}>
          <Text style={styles.org}>FIRE AND FRAGRANCE SOUTH AFRICA</Text>
        </View>
        {forChecking && (
          <Text style={styles.check}>
            FOR CHECKING ONLY. NOT VALID UNTIL FFSA HAS SIGNED AND STAMPED IT. CHECK YOUR NAME, PASSPORT NUMBER AND
            DATES.
          </Text>
        )}
        {letterParagraphs(text).map((p, i) =>
          p === SIGNATURE_MARK ? <View key={i} style={styles.sign} /> : <Text key={i} style={styles.para}>{p}</Text>
        )}
        <View style={styles.foot} fixed>
          <Text>Ref. {reference}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
