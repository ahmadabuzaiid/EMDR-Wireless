// A discrete "digital" slider: the thumb only ever rests on one of a fixed set of
// step dots (no in-between/decimal values, unlike an analog slider that merely
// snaps on release) - dragging or tapping anywhere on the track jumps straight to
// the nearest step, and every step is drawn as its own dot so the control visually
// reads as a small number of distinct phases rather than a continuous range.
import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import { colors } from '../theme/colors';

interface StepSliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}

const TRACK_HEIGHT = 6;
const THUMB_SIZE = 28;
const DOT_SIZE = 6;

export default function StepSlider({ min, max, value, onChange, step = 1 }: StepSliderProps) {
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const containerPageX = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);

  // The PanResponder below is built once via useRef and must never close over
  // min/max/step/onChange directly - those all change identity across renders
  // (onChange in particular: it's a useCallback in SessionContext whose identity
  // changes when a session starts/stops), and a useRef initializer only runs on
  // the very first render. A frozen closure over the pre-session-start onChange
  // silently ate every live slider write during a running session (only a full
  // Stop -> Start ever sent the new value, since that path calls the engine
  // directly instead of going through this component). Keeping the latest
  // values in refs, updated every render, lets the responder stay stable while
  // still always calling through to the current onChange.
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const stepRef = useRef(step);
  const onChangeRef = useRef(onChange);
  minRef.current = min;
  maxRef.current = max;
  stepRef.current = step;
  onChangeRef.current = onChange;

  const stepCount = Math.max(1, Math.round((max - min) / step));
  const dots = Array.from({ length: stepCount + 1 }, (_, i) => i);

  const measure = useCallback(() => {
    containerRef.current?.measure((_x: number, _y: number, width: number, _height: number, pageX: number) => {
      containerPageX.current = pageX;
      trackWidthRef.current = width;
      setTrackWidth(width);
    });
  }, []);

  const onTrackLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      measure();
    },
    [measure],
  );

  const valueFromPageX = useCallback((pageX: number) => {
    const width = trackWidthRef.current;
    const localMin = minRef.current;
    const localMax = maxRef.current;
    const localStep = stepRef.current;
    if (width <= 0) return localMin;
    const localX = pageX - containerPageX.current;
    const ratio = Math.min(1, Math.max(0, localX / width));
    const raw = localMin + ratio * (localMax - localMin);
    const snapped = Math.round(raw / localStep) * localStep;
    return Math.min(localMax, Math.max(localMin, snapped));
  }, []);

  // A touch that feels like a single, stationary tap still delivers several
  // onPanResponderMove events (ordinary finger micro-jitter) - without this
  // guard, every one of them re-fired onChange with the *same* snapped value,
  // which downstream (e.g. a running session re-arming on every timing change)
  // turned one tap into a burst of duplicate BLE writes. Only emit when the
  // snapped value actually changes.
  const lastEmittedRef = useRef(value);

  const emitIfChanged = useCallback((next: number) => {
    if (next === lastEmittedRef.current) return;
    lastEmittedRef.current = next;
    onChangeRef.current(next);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_evt, gestureState) => {
        measure();
        emitIfChanged(valueFromPageX(gestureState.x0));
      },
      onPanResponderMove: (_evt, gestureState) => {
        emitIfChanged(valueFromPageX(gestureState.moveX));
      },
    }),
  ).current;

  const progress = max > min ? (value - min) / (max - min) : 0;
  const thumbLeft = trackWidth > 0 ? progress * (trackWidth - THUMB_SIZE) : 0;

  return (
    <View style={styles.wrapper}>
      <View
        ref={containerRef}
        style={styles.trackContainer}
        onLayout={onTrackLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.thumb, { left: thumbLeft }]} />
      </View>
      <View style={styles.dotsRow}>
        {dots.map(i => (
          <View key={i} style={styles.dot} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  trackContainer: { height: THUMB_SIZE, justifyContent: 'center' },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: THUMB_SIZE / 2 - DOT_SIZE / 2,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: colors.border,
  },
});
