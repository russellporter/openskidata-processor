#!/usr/bin/env python3
"""
HDF to GeoTIFF Conversion Tool

This script converts HDF files (specifically VIIRS snow cover data) to GeoTIFF format
while preserving the original sinusoidal projection.

Requirements:
- GDAL/OGR Python bindings (install with: pip install gdal)
"""

import os
import sys
import argparse
import re
from osgeo import gdal, osr


def get_hdf_subdatasets(hdf_file):
    """
    Get list of subdatasets from HDF file
    
    Args:
        hdf_file: Path to HDF file
        
    Returns:
        List of subdataset names
    """
    dataset = gdal.Open(hdf_file, gdal.GA_ReadOnly)
    if not dataset:
        raise ValueError(f"Cannot open HDF file: {hdf_file}")
    
    subdatasets = dataset.GetSubDatasets()
    if not subdatasets:
        print("No subdatasets found. This might be a single-dataset HDF.")
        return None
    
    # Print available subdatasets
    print("\nAvailable subdatasets:")
    for i, (name, desc) in enumerate(subdatasets):
        print(f"{i}: {desc}")
    
    dataset = None
    return subdatasets


def convert_hdf_to_geotiff(hdf_file, output_file, subdataset_index=2):
    """
    Convert HDF file to GeoTIFF preserving original projection
    
    Args:
        hdf_file: Path to input HDF file
        output_file: Path to output GeoTIFF file
        subdataset_index: Index of subdataset to convert (default: 2 - CGF_NDSI_Snow_Cover)
    """
    # Get subdatasets
    subdatasets = get_hdf_subdatasets(hdf_file)
    
    # Open the specific subdataset
    if subdatasets:
        subdataset_name = subdatasets[subdataset_index][0]
        print(f"\nProcessing subdataset: {subdatasets[subdataset_index][1]}")
    else:
        subdataset_name = hdf_file
        print(f"\nProcessing HDF file directly")
    
    # Open source dataset
    src_ds = gdal.Open(subdataset_name, gdal.GA_ReadOnly)
    if not src_ds:
        raise ValueError(f"Cannot open subdataset: {subdataset_name}")
    
    # Get raster dimensions
    cols = src_ds.RasterXSize
    rows = src_ds.RasterYSize
    bands = src_ds.RasterCount
    
    print(f"Dimensions: {cols} x {rows}, Bands: {bands}")
    
    # Define the sinusoidal projection used by VIIRS
    srs = osr.SpatialReference()
    srs.SetProjCS("MODIS Sinusoidal")
    srs.SetGeogCS("Unknown datum based upon the custom spheroid",
                  "Not_specified_based_on_custom_spheroid",
                  "Custom spheroid", 6371007.181, 0.0,
                  "Greenwich", 0.0)
    srs.SetSinusoidal(0.0, 0.0, 0.0)
    
    # Get or calculate geotransform
    geotransform = src_ds.GetGeoTransform()
    
    # If geotransform is default (not set), calculate it from tile info
    if geotransform == (0.0, 1.0, 0.0, 0.0, 0.0, 1.0):
        # Extract tile info from filename
        filename = os.path.basename(hdf_file)
        tile_match = re.search(r'h(\d{2})v(\d{2})', filename)
        
        if tile_match:
            h = int(tile_match.group(1))
            v = int(tile_match.group(2))
            print(f"Detected tile: h{h:02d}v{v:02d}")
            
            from constants import TILE_SIZE_METERS, PIXEL_SIZE
            # MODIS/VIIRS sinusoidal grid parameters
            tile_size = TILE_SIZE_METERS  # meters (10 degrees at equator)
            pixel_size = PIXEL_SIZE  # meters for VIIRS 375m product
            
            # Calculate upper left corner of tile
            # Origin is at (0,0) in the center, with 18 tiles in each direction
            x_min = (h - 18) * tile_size
            y_max = (9 - v) * tile_size
            
            # Set geotransform
            geotransform = (x_min, pixel_size, 0.0, y_max, 0.0, -pixel_size)
            print(f"Calculated geotransform: {geotransform}")
        else:
            print("Warning: Could not extract tile info from filename")
    
    # Create output GeoTIFF
    driver = gdal.GetDriverByName('GTiff')
    if not driver:
        raise ValueError("GTiff driver not available")
    
    # Set creation options
    options = ['COMPRESS=LZW', 'TILED=YES', 'BIGTIFF=IF_SAFER']
    
    # Create output dataset
    dst_ds = driver.Create(output_file, cols, rows, bands, src_ds.GetRasterBand(1).DataType, options)
    if not dst_ds:
        raise ValueError(f"Could not create output file: {output_file}")
    
    # Set projection and geotransform
    dst_ds.SetProjection(srs.ExportToWkt())
    dst_ds.SetGeoTransform(geotransform)
    
    # Copy data band by band
    for band_num in range(1, bands + 1):
        print(f"Copying band {band_num}/{bands}")
        src_band = src_ds.GetRasterBand(band_num)
        dst_band = dst_ds.GetRasterBand(band_num)
        
        # Read data
        data = src_band.ReadAsArray()
        
        # Write data
        dst_band.WriteArray(data)
        
        # Copy band metadata
        dst_band.SetNoDataValue(src_band.GetNoDataValue())
        dst_band.SetDescription(src_band.GetDescription())
        
        # Copy color table if exists
        color_table = src_band.GetColorTable()
        if color_table:
            dst_band.SetColorTable(color_table)
        
        # Flush band
        dst_band.FlushCache()
    
    # Copy metadata
    metadata = src_ds.GetMetadata()
    if metadata:
        dst_ds.SetMetadata(metadata)
    
    # Close datasets
    src_ds = None
    dst_ds = None
    
    print(f"Successfully created: {output_file}")
    
    # Print information about the output
    verify_ds = gdal.Open(output_file, gdal.GA_ReadOnly)
    if verify_ds:
        print(f"\nOutput GeoTIFF information:")
        print(f"Size: {verify_ds.RasterXSize} x {verify_ds.RasterYSize}")
        gt = verify_ds.GetGeoTransform()
        print(f"Pixel size: {gt[1]} x {-gt[5]} meters")
        print(f"Upper left: {gt[0]}, {gt[3]}")
        print(f"Lower right: {gt[0] + gt[1] * verify_ds.RasterXSize}, {gt[3] + gt[5] * verify_ds.RasterYSize}")
        verify_ds = None


def batch_convert(input_dir, output_dir, file_pattern="*.h5", subdataset_index=2):
    """
    Batch convert multiple HDF files
    
    Args:
        input_dir: Directory containing HDF files
        output_dir: Directory for output GeoTIFF files
        file_pattern: File pattern to match (default: *.h5)
        subdataset_index: Index of subdataset to convert
    """
    import glob
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Find all matching files
    search_pattern = os.path.join(input_dir, file_pattern)
    hdf_files = glob.glob(search_pattern)
    
    if not hdf_files:
        print(f"No files found matching pattern: {search_pattern}")
        return
    
    print(f"Found {len(hdf_files)} files to process")
    
    # Process each file
    for i, hdf_file in enumerate(hdf_files):
        print(f"\n[{i+1}/{len(hdf_files)}] Processing: {os.path.basename(hdf_file)}")
        
        # Generate output filename
        base_name = os.path.basename(hdf_file)
        output_name = os.path.splitext(base_name)[0] + ".tif"
        output_file = os.path.join(output_dir, output_name)
        
        try:
            convert_hdf_to_geotiff(hdf_file, output_file, subdataset_index)
        except Exception as e:
            print(f"Error processing {hdf_file}: {str(e)}")
            continue


def main():
    parser = argparse.ArgumentParser(
        description="Convert VIIRS HDF files to GeoTIFF preserving sinusoidal projection",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Convert single file (default: CGF_NDSI_Snow_Cover)
  python hdf_to_geotiff.py input.h5 output.tif
  
  # Convert specific subdataset
  python hdf_to_geotiff.py input.h5 output.tif --subdataset 4
  
  # List available subdatasets
  python hdf_to_geotiff.py input.h5 --list-subdatasets
  
  # Batch process directory
  python hdf_to_geotiff.py --batch input_dir/ output_dir/ --subdataset 2
  
Subdataset indices for VIIRS snow cover:
  0: Algorithm_Bit_Flags_QA
  1: Basic_QA
  2: CGF_NDSI_Snow_Cover (gap-filled snow cover) - DEFAULT
  3: Cloud_Persistence
  4: Daily_NDSI_Snow_Cover (original daily snow cover)
        """
    )
    
    # Positional arguments for single file mode
    parser.add_argument('input', nargs='?', help='Input HDF file')
    parser.add_argument('output', nargs='?', help='Output GeoTIFF file')
    
    # Batch mode
    parser.add_argument('--batch', nargs=2, metavar=('INPUT_DIR', 'OUTPUT_DIR'),
                       help='Batch process directory')
    
    # Options
    parser.add_argument('--subdataset', type=int, default=2,
                       help='Subdataset index to process (default: 2 - CGF_NDSI_Snow_Cover)')
    parser.add_argument('--list-subdatasets', action='store_true',
                       help='List available subdatasets and exit')
    
    args = parser.parse_args()
    
    # Check for batch mode
    if args.batch:
        batch_convert(
            args.batch[0], 
            args.batch[1],
            subdataset_index=args.subdataset
        )
    elif args.input:
        # Single file mode
        if args.list_subdatasets:
            get_hdf_subdatasets(args.input)
        else:
            if not args.output:
                parser.error("Output file required when not using --list-subdatasets")
            
            convert_hdf_to_geotiff(
                args.input,
                args.output,
                subdataset_index=args.subdataset
            )
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    # Enable GDAL exceptions
    gdal.UseExceptions()
    
    main()
