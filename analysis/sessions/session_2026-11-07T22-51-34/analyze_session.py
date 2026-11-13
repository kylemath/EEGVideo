#!/usr/bin/env python3
"""
Muse S Athena — Brain & Computer-Use Correlation Analysis Starter Script
========================================================================
Loads the synchronized datasets exported by the Muse S Athena Chrome Extension:
  - physiology_timeseries.csv (4 Hz continuous EEG bands, Focus, Calm, FAA, fNIRS HbO2/HHb/HbT, HR, HRV)
  - computer_use_events.csv   (clicks, typing cadence/WPM, scrolls, navigations, screenshots + instantaneous physio)
  - session_bundle.jsonl      (unified event + physiology + screenshot metadata stream)

Usage:
  python3 analyze_session.py
"""

import pandas as pd
import numpy as np

def main():
    physio = pd.read_csv("physiology_timeseries.csv")
    events = pd.read_csv("computer_use_events.csv")

    print(f"Loaded {len(physio):,} physiological state ticks (4 Hz) and {len(events):,} computer-use events.")
    if len(physio) > 0:
        duration_min = (physio["timestamp_ms"].max() - physio["timestamp_ms"].min()) / 60000.0
        print(f"Session Duration: {duration_min:.2f} minutes\n")

        print("=== Physiological Summary Across Session ===")
        cols = [
            "heart_rate_bpm", "hrv_rmssd_ms",
            "hbo2_uM", "hhb_uM", "hbt_uM",
            "focus_index", "calm_index", "frontal_alpha_asymmetry",
            "alpha_rel", "beta_rel", "theta_rel"
        ]
        available = [c for c in cols if c in physio.columns]
        print(physio[available].describe().round(3))

    if len(events) > 0 and "domain" in events.columns:
        print("\n=== Mean Physiological State by Website Domain ===")
        by_domain = events.groupby("domain").agg(
            event_count=("event_type", "count"),
            mean_focus=("focus_index", "mean"),
            mean_alpha_rel=("alpha_rel", "mean"),
            mean_hr_bpm=("heart_rate_bpm", "mean"),
            mean_hbo2_uM=("hbo2_uM", "mean"),
            mean_hbt_uM=("hbt_uM", "mean"),
        ).round(3)
        print(by_domain.sort_values("event_count", ascending=False).head(15))

        print("\n=== High-Focus vs. High-Alpha Moments & Associated Screenshots ===")
        tagged = events[events["state_tags"].notna() & (events["state_tags"] != "")]
        for _, row in tagged.head(10).iterrows():
            print(
                f"[{row['iso_time']}] {row['event_type']} on {row['domain']} | "
                f"Tags={row['state_tags']} | Focus={row['focus_index']:.2f} | "
                f"HbO2={row['hbo2_uM']:.2f} uM | HR={row['heart_rate_bpm']} BPM | "
                f"Shot={row['screenshot_id']}"
            )

if __name__ == "__main__":
    main()
