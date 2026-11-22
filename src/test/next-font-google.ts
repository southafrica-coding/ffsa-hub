/** Vitest stand-in. Next replaces `next/font/google` at build time; the package file is empty. */

type Face = { className: string; variable: string; style: { fontFamily: string } };

function face(name: string): () => Face {
  return () => ({
    className: `font-${name}`,
    variable: `var-${name}`,
    style: { fontFamily: name },
  });
}

export const Archivo = face("Archivo");
export const Fraunces = face("Fraunces");
export const Roboto = face("Roboto");
export const Roboto_Condensed = face("Roboto_Condensed");
export const Roboto_Mono = face("Roboto_Mono");
export const Bebas_Neue = face("Bebas_Neue");
export const Anton = face("Anton");
export const Space_Mono = face("Space_Mono");
export const Cormorant_Garamond = face("Cormorant_Garamond");
export const DM_Sans = face("DM_Sans");
