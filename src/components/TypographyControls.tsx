"use client";
import type { Layer } from "@/lib/schema";
export function TypographyControls({
  layer,
  label,
  onChange,
  editContent = true,
  fonts = [],
}: {
  layer: Layer;
  label: string;
  onChange: (layer: Layer) => void;
  editContent?: boolean;
  // Fonts uploaded to this project.
  fonts?: { id: string; name: string }[];
}) {
  return (
    <div
      className="typography-controls layer-fields"
      role="group"
      aria-label={`${label} typography`}
    >
      {editContent && (
        <label>
          Text
          <textarea
            aria-label={`${label} text`}
            value={layer.text}
            maxLength={140}
            rows={2}
            onChange={(e) => onChange({ ...layer, text: e.target.value })}
          />
        </label>
      )}
      {editContent && (
        <label>
          Font size
          <input
            aria-label={`${label} font size`}
            type="number"
            min={12}
            max={120}
            step={1}
            value={layer.fontSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 12 && n <= 120) onChange({ ...layer, fontSize: n });
            }}
          />
        </label>
      )}
      <label>
        Font
        <select
          aria-label={`${label} font`}
          value={layer.fontFamily || "sans"}
          onChange={(e) =>
            onChange({
              ...layer,
              fontFamily: e.target.value as Layer["fontFamily"],
            })
          }
        >
          <option value="sans">Sans serif</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
        </select>
      </label>
      {(fonts.length > 0 || layer.fontAssetId) && (
        <label>
          Brand font
          <select
            aria-label={`${label} brand font`}
            value={layer.fontAssetId || ""}
            onChange={(e) =>
              onChange({
                ...layer,
                fontAssetId: e.target.value || undefined,
              })
            }
          >
            <option value="">None (use the font above)</option>
            {fonts.map((font) => (
              <option key={font.id} value={font.id}>
                {font.name}
              </option>
            ))}
            {layer.fontAssetId &&
              !fonts.some((font) => font.id === layer.fontAssetId) && (
                <option value={layer.fontAssetId}>Missing font</option>
              )}
          </select>
        </label>
      )}
      <label>
        Weight
        <select
          aria-label={`${label} weight`}
          value={layer.fontWeight || "auto"}
          onChange={(e) =>
            onChange({
              ...layer,
              fontWeight:
                e.target.value === "auto"
                  ? undefined
                  : (e.target.value as Layer["fontWeight"]),
            })
          }
        >
          <option value="auto">Default</option>
          <option value="regular">Regular</option>
          <option value="medium">Medium</option>
          <option value="semibold">Semibold</option>
          <option value="bold">Bold</option>
          <option value="heavy">Heavy</option>
        </select>
      </label>
      <label>
        Text alignment
        <select
          aria-label={`${label} alignment`}
          value={layer.textAlign || "left"}
          onChange={(e) =>
            onChange({
              ...layer,
              textAlign: e.target.value as Layer["textAlign"],
            })
          }
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label>
        Line spacing
        <input
          aria-label={`${label} line spacing`}
          type="number"
          min={1}
          max={2}
          step={0.05}
          value={layer.lineHeight || 1.12}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n >= 1 && n <= 2) onChange({ ...layer, lineHeight: n });
          }}
        />
      </label>
      <label>
        Letter spacing
        <input
          aria-label={`${label} letter spacing`}
          type="number"
          min={-2}
          max={8}
          step={0.25}
          value={layer.letterSpacing || 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n >= -2 && n <= 8) onChange({ ...layer, letterSpacing: n });
          }}
        />
      </label>
      <label>
        <input
          aria-label={`${label} italic`}
          type="checkbox"
          checked={!!layer.italic}
          onChange={(e) => onChange({ ...layer, italic: e.target.checked })}
        />{" "}
        Italic
      </label>
      <label>
        <input
          aria-label={`${label} underline`}
          type="checkbox"
          checked={!!layer.underline}
          onChange={(e) => onChange({ ...layer, underline: e.target.checked })}
        />{" "}
        Underline
      </label>
      <button
        className="subtle"
        type="button"
        title="Reset font, weight, alignment, spacing and decorations; keep text and size."
        onClick={() =>
          onChange({
            ...layer,
            fontFamily: undefined,
            fontWeight: undefined,
            textAlign: undefined,
            lineHeight: undefined,
            letterSpacing: undefined,
            italic: undefined,
            underline: undefined,
          })
        }
      >
        Reset text style
      </button>
    </div>
  );
}
