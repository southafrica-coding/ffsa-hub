import { renderToBuffer } from "@react-pdf/renderer";
import {
  WaiverCertificateDocument,
  type WaiverCertificateArgs,
} from "./waiver-pdf";

// Thin wrapper so fulfillment.ts (a .ts file) can render the signed
// certificate without importing JSX directly. Returns the PDF bytes.
export async function renderWaiverCertificate(
  args: WaiverCertificateArgs
): Promise<Buffer> {
  return renderToBuffer(<WaiverCertificateDocument {...args} />);
}
