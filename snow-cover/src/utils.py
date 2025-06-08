#!/usr/bin/env python3
"""
Shared utility functions for VIIRS snow cover data processing.

Contains common date handling, cache formatting, and other utility functions.
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from cache_manager import PixelWeeklyData


def calculate_week_index(date: datetime, year: int) -> int:
    """
    Calculate week index within a year.
    
    Args:
        date: Date to calculate week index for
        year: Year to calculate week index within
    
    Returns:
        Week index (0-52)
    """
    year_start = datetime(year, 1, 1)
    return (date - year_start).days // 7


def generate_weekly_dates(start_date: datetime, end_date: datetime) -> List[datetime]:
    """
    Generate weekly sampling dates starting from start_date.
    
    Args:
        start_date: Start date for sampling
        end_date: End date for sampling
    
    Returns:
        List of datetime objects for weekly samples
    """
    dates = []
    current_date = start_date
    
    while current_date <= end_date:
        dates.append(current_date)
        current_date += timedelta(days=7)
    
    return dates


def format_cache_stats(stats: Dict[str, int]) -> str:
    """
    Format cache statistics for display.
    
    Args:
        stats: Dictionary with cache statistics
    
    Returns:
        Formatted string for display
    """
    lines = []
    for key, value in stats.items():
        if key == 'total_size_bytes':
            lines.append(f"  {key}: {value:,} bytes ({value/1024/1024:.2f} MB)")
        else:
            lines.append(f"  {key}: {value:,}")
    
    return "\n".join(lines)


def create_empty_year_data(year: int) -> "PixelWeeklyData":
    """
    Create empty PixelWeeklyData for a year.
    
    Args:
        year: Year to create data for
    
    Returns:
        PixelWeeklyData with 53 weeks of empty data
    """
    from cache_manager import PixelWeeklyData
    return PixelWeeklyData(year=year, data=[[None, 0] for _ in range(53)])


def validate_file_exists(file_path: str, error_message: str = None) -> bool:
    """
    Validate that a file exists, with consistent error handling.
    
    Args:
        file_path: Path to file to validate
        error_message: Custom error message (optional)
    
    Returns:
        True if file exists, False otherwise (also prints error and exits)
    """
    if not Path(file_path).exists():
        if error_message:
            print(error_message)
        else:
            print(f"Error: File not found: {file_path}")
        sys.exit(1)
    
    return True