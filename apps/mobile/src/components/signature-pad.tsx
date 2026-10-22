import { normalizeStrokes, type PadPoint, type SignatureStroke } from "@healthcare/domain/signature";
import { useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/components/theme";
import { addPoint, strokeBoxes } from "@/lib/signature-draw";

const THICKNESS = 3;

/**
 * A pad to draw a signature with a finger (3:1). It reports what was drawn as strokes in 0..1 (`onChange`) and keeps nothing
 * itself. `onDrawing` tells the screen to stop scrolling while a finger is down, so drawing does not scroll the page.
 */
export function SignaturePad({
  onChange,
  onDrawing,
  disabled = false,
}: {
  onChange: (strokes: SignatureStroke[]) => void;
  onDrawing?: (drawing: boolean) => void;
  disabled?: boolean;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const strokes = useRef<PadPoint[][]>([]);
  const [, redraw] = useState(0);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const report = () => onChange(normalizeStrokes(strokes.current, sizeRef.current.width, sizeRef.current.height));

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabledRef.current,
        onMoveShouldSetPanResponder: () => !disabledRef.current,
        // Keep the gesture while the finger moves: a parent ScrollView must not take it over.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          onDrawing?.(true);
          strokes.current.push([{ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }]);
          redraw((n) => n + 1);
        },
        onPanResponderMove: (event) => {
          const current = strokes.current[strokes.current.length - 1];
          if (current && addPoint(current, { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY })) redraw((n) => n + 1);
        },
        onPanResponderRelease: () => {
          onDrawing?.(false);
          report();
        },
        onPanResponderTerminate: () => {
          onDrawing?.(false);
          report();
        },
      }),
    // The responder reads the current size and callbacks through refs and closures created once per mount.
    [],
  );

  const clear = () => {
    strokes.current = [];
    redraw((n) => n + 1);
    onChange([]);
  };

  const empty = strokes.current.length === 0;
  return (
    <View style={styles.wrap}>
      <View
        style={styles.pad}
        onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        accessibilityLabel="Signature pad: draw your signature here with your finger"
        {...responder.panHandlers}
      >
        {strokes.current.flatMap((stroke, i) =>
          strokeBoxes(stroke, THICKNESS).map((box, j) => (
            <View
              key={`${i}-${j}`}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: box.length,
                height: box.thickness,
                borderRadius: box.thickness / 2,
                backgroundColor: colors.foreground,
                transform: [{ rotate: `${box.angle}deg` }],
              }}
            />
          )),
        )}
      </View>
      <Pressable onPress={clear} disabled={empty || disabled} accessibilityRole="button" style={[styles.clear, (empty || disabled) && styles.clearOff]}>
        <Text style={styles.clearText}>Clear</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  // 3:1, the proportions the API and the printed form use.
  pad: { width: "100%", aspectRatio: 3, backgroundColor: "#ffffff", borderColor: colors.border, borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  clear: { alignSelf: "flex-start", borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  clearOff: { opacity: 0.4 },
  clearText: { fontSize: 14, color: colors.foreground },
});
