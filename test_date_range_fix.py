#!/usr/bin/env python3
"""
Quick test script to verify the date range bug fix
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.backtest.data_replay import DataReplayAgent
from datetime import datetime

async def test_date_range_fix():
    print("\\n" + "=" * 60)
    print("🧪 Testing Date Range Bug Fix")
    print("=" * 60)
    
    # Create replay agent with the problematic date range
    replay = DataReplayAgent(
        symbol="BTCUSDT",
        start_date="2025-12-31",
        end_date="2026-01-01"
    )
    
    print(f"\\n📅 Configured date range:")
    print(f"   Start: 2025-12-31")
    print(f"   End: 2026-01-01")
    print(f"   Expected: 2 days of data")
    
    # Load data
    print(f"\\n📥 Loading historical data...")
    success = await replay.load_data()
    
    if not success:
        print("❌ Failed to load data!")
        return False
    
    print(f"✅ Data loaded successfully")
    
    # Check timestamps
    timestamps = replay.timestamps
    print(f"\\n📊 Total timestamps: {len(timestamps)}")
    
    if len(timestamps) == 0:
        print("❌ No timestamps found!")
        return False
    
    # Find timestamps from each date
    dec_31_timestamps = [t for t in timestamps if t.date() == datetime(2025, 12, 31).date()]
    jan_1_timestamps = [t for t in timestamps if t.date() == datetime(2026, 1, 1).date()]
    
    print(f"\\n📅 Timestamps by date:")
    print(f"   2025-12-31: {len(dec_31_timestamps)} timestamps")
    print(f"   2026-01-01: {len(jan_1_timestamps)} timestamps")
    
    # Verify fix
    if len(jan_1_timestamps) == 0:
        print("\\n❌ BUG STILL EXISTS: No timestamps from 2026-01-01!")
        print("   The end_date is still being excluded.")
        return False
    
    print(f"\\n✅ FIX VERIFIED!")
    print(f"   Both days have data")
    print(f"   Total days: 2")
    print(f"   2025-12-31: {len(dec_31_timestamps)} K-lines")
    print(f"   2026-01-01: {len(jan_1_timestamps)} K-lines")
    
    # Show first and last timestamps
    print(f"\\n📍 Timestamp range:")
    print(f"   First: {timestamps[0]}")
    print(f"   Last: {timestamps[-1]}")
    
    return True

if __name__ == "____main__":
    result = asyncio.run(test_date_range_fix())
    sys.exit(0 if result else 1)
