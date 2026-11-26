import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { KIND_LABEL, fmtRand, type VehicleReport } from "./report";
import { fmtDate, fmtKm } from "./rules";

// The vehicle history report as a PDF (A4): the Hub's look (black bars, hairline rules,
// condensed caps), a summary, the issues still open, then everything in the period by date.

const INK = "#0A0A0A";
const MUTED = "#55524A";
const RULE = "#DEDACE";

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontSize: 9.5, fontFamily: "Helvetica", color: INK, lineHeight: 1.35 },
  bar: { backgroundColor: INK, color: "#FFFFFF", paddingVertical: 6, paddingHorizontal: 10, fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.5, textTransform: "uppercase" },
  tick: { width: 18, height: 3, backgroundColor: "#FFB801", marginTop: 14, marginBottom: 6 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", textTransform: "uppercase", lineHeight: 1.05 },
  sub: { marginTop: 4, color: MUTED },
  period: { marginTop: 8, fontFamily: "Helvetica-Bold", fontSize: 10 },
  section: { marginTop: 16, marginBottom: 6, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: INK, color: "#FFFFFF", fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1.2, textTransform: "uppercase" },
  stats: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderTopColor: INK },
  stat: { width: "25%", paddingVertical: 6, paddingRight: 6, borderBottomWidth: 0.5, borderBottomColor: RULE },
  statK: { fontSize: 7, color: MUTED, letterSpacing: 1, textTransform: "uppercase" },
  statV: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 2 },
  row: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: RULE },
  date: { width: 62, fontFamily: "Helvetica-Bold" },
  kind: { width: 62, fontSize: 7, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase", paddingTop: 1 },
  body: { flex: 1, paddingRight: 8 },
  entryTitle: { fontFamily: "Helvetica-Bold" },
  line: { color: "#2B2A26", marginTop: 1 },
  cost: { width: 70, textAlign: "right", fontFamily: "Helvetica-Bold" },
  empty: { color: MUTED, paddingVertical: 6 },
  issue: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: RULE },
  issueState: { width: 62, fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

export function VehicleReportDocument({ r }: { r: VehicleReport }) {
  const sm = r.summary;
  const stats: [string, string][] = [
    ["Km at start", sm.kmStart != null ? fmtKm(sm.kmStart) : "—"],
    ["Km at end", sm.kmEnd != null ? fmtKm(sm.kmEnd) : "—"],
    ["Km in the period", sm.kmDriven != null ? fmtKm(sm.kmDriven) : "—"],
    ["Spent at the workshop", sm.spend ? fmtRand(sm.spend) : "R 0,00"],
    ["Workshop visits", String(sm.workshop)],
    ["Inspections", String(sm.inspections)],
    ["Fixes", String(sm.fixes)],
    ["Bookings", String(sm.bookings)],
  ];
  return (
    <Document title={`Vehicle history: ${r.title} (${r.period})`} author="FFSA Hub · Fleet">
      <Page size="A4" style={s.page}>
        <Text style={s.bar}>FFSA Fleet · Vehicle history report</Text>
        <View style={s.tick} />
        <Text style={s.title}>{r.title}</Text>
        {r.vehicleLine ? <Text style={s.sub}>{r.vehicleLine}</Text> : null}
        <Text style={s.period}>{r.period}</Text>

        <Text style={s.section}>Summary</Text>
        <View style={s.stats}>
          {stats.map(([k, v]) => (
            <View key={k} style={s.stat}>
              <Text style={s.statK}>{k}</Text>
              <Text style={s.statV}>{v}</Text>
            </View>
          ))}
        </View>

        <Text style={s.section}>Open issues now ({r.open.length})</Text>
        {r.open.length ? (
          r.open.map((o, i) => (
            <View key={i} style={s.issue} wrap={false}>
              <Text style={s.issueState}>{o.state}</Text>
              <Text style={s.body}>
                {o.point}
                {o.note ? <Text style={{ color: MUTED }}> · {o.note}</Text> : null}
                {o.since ? <Text style={{ color: MUTED }}> · since {o.since}</Text> : null}
              </Text>
            </View>
          ))
        ) : (
          <Text style={s.empty}>None: nothing marked Fix now or Monitor.</Text>
        )}

        <Text style={s.section}>History ({r.entries.length})</Text>
        {r.entries.length ? (
          r.entries.map((e, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={s.date}>{fmtDate(e.date)}</Text>
              <Text style={s.kind}>{KIND_LABEL[e.kind]}</Text>
              <View style={s.body}>
                <Text style={s.entryTitle}>{e.title}</Text>
                {e.lines.map((l, j) => (
                  <Text key={j} style={s.line}>
                    {l}
                  </Text>
                ))}
              </View>
              <Text style={s.cost}>{e.cost != null ? fmtRand(e.cost) : ""}</Text>
            </View>
          ))
        ) : (
          <Text style={s.empty}>Nothing recorded in this period.</Text>
        )}

        <View style={s.footer} fixed>
          <Text>
            {r.title} · {r.period} · made {r.generated}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderVehicleReportPdf(r: VehicleReport): Promise<Buffer> {
  return renderToBuffer(<VehicleReportDocument r={r} />);
}
