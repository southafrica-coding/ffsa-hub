        const downloadedFiles = await Promise.all(fontFiles.map(async ({ googleFontFileUrl, preloadFontFile, ext }) => {
            const hasCachedFont = fontCache.has(googleFontFileUrl);
            // Download the font file or get it from cache
            const fontFileBuffer = hasCachedFont
                ? fontCache.get(googleFontFileUrl)
                : await (0, fetch_font_file_1.fetchFontFile)(googleFontFileUrl, isDev).catch((err) => {
                    console.error(err);
                    return null;
                });
            if (!hasCachedFont) {
                fontCache.set(googleFontFileUrl, fontFileBuffer !== null && fontFileBuffer !== void 0 ? fontFileBuffer : null);
            }
            else {
                fontCache.delete(googleFontFileUrl);
            }
            if (fontFileBuffer == null) {
                (0, next_font_error_1.nextFontError)(`Failed to fetch \`${fontFamily}\` from Google Fonts.`);
            }
            /* ext comes from findFontFilesInCss */
