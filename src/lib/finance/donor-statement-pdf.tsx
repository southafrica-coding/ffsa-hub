import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { fmtUsd, formatUsDate, type Donor } from "./donor-statements";
import { wordingOf, type WordingSettings } from "./donor-statement-wording";

// The year-end statement, in the order finance specified (Ellen, Oct 2026):
// logo, organisation, Tax ID, address, "[Year] Donation Summary for …",
// greeting, total, one line per gift, mission paragraph, IRS paragraph
// (word for word — the written acknowledgment for gifts of $250+),
// closing, signature, signer.

export type StatementImage = { data: Buffer; format: "png" | "jpg" };

export type StatementPdfArgs = {
  settings: WordingSettings;
  donor: Pick<Donor, "name" | "totalCents" | "gifts">;
  year: number;
  logo: StatementImage | null;
  signature: StatementImage | null;
};

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 48, paddingHorizontal: 56, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.45 },
  center: { textAlign: "center" },
  logo: { width: 100, height: 100, objectFit: "contain", alignSelf: "center", marginBottom: 10 },
  org: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "center", letterSpacing: 0.5 },
  taxId: { textAlign: "center", marginTop: 6 },
  address: { textAlign: "center", marginTop: 6, color: "#333" },
  summary: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 22, marginBottom: 14 },
  greeting: { marginBottom: 12 },
  total: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 12 },
  detailsHead: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  line: { marginBottom: 1 },
  note: { color: "#555" },
  para: { marginTop: 14 },
  closing: { marginTop: 18 },
  signature: { width: 150, height: 70, objectFit: "contain", marginTop: 6, marginBottom: 2 },
  signer: { marginTop: 0 },
});

export function DonorStatementDocument({ settings, donor, year, logo, signature }: StatementPdfArgs) {
  const w = wordingOf(settings);
  return (
    <Document title={`${settings.org_name} - ${year} Donation Statement - ${donor.name}`} author={settings.org_name}>
      <Page size="LETTER" style={s.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        {logo && <Image src={logo} style={s.logo} />}
        <Text style={s.org}>{settings.org_name}</Text>
        <Text style={s.taxId}>Tax ID: {settings.tax_id}</Text>
        <View style={s.address}>
          <Text>{settings.address_line1}</Text>
          <Text>{settings.address_line2}</Text>
          <Text>{settings.address_city_line}</Text>
        </View>

        <Text style={s.summary}>
          {year} Donation Summary for {donor.name}
        </Text>
        <Text style={s.greeting}>Dear {donor.name},</Text>

        <Text style={s.total}>Total Donations: {fmtUsd(donor.totalCents)}</Text>

        <Text style={s.detailsHead}>Donation Details:</Text>
        {donor.gifts.map((g) => (
          <Text key={g.invoiceNumber} style={s.line} wrap={false}>
            Date: {formatUsDate(g.date)} | Amount: {fmtUsd(g.amountCents)}
            {g.amountCents < 0 && <Text style={s.note}> (reversal of an earlier gift)</Text>}
          </Text>
        ))}

        <Text style={s.para}>{w.mission}</Text>
        <Text style={s.para}>{w.irs}</Text>

        <View wrap={false}>
          <Text style={s.closing}>{w.closing}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          {signature ? <Image src={signature} style={s.signature} /> : <View style={{ height: 40 }} />}
          <Text style={s.signer}>{settings.signer_name}</Text>
          <Text>{settings.signer_title}</Text>
          <Text>{settings.org_name}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderDonorStatementPdf(args: StatementPdfArgs): Promise<Buffer> {
  return renderToBuffer(<DonorStatementDocument {...args} />);
}
