import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const apiKey = process.env.AUTO_DEV_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { 
          error: 'Auto.dev API key not configured. Please ensure AUTO_DEV_API_KEY is set in your environment variables.',
          details: process.env.NODE_ENV === 'development' 
            ? 'Make sure you have a .env.local file with AUTO_DEV_API_KEY'
            : 'Make sure AUTO_DEV_API_KEY is configured in Vercel project settings and redeploy after adding it.'
        },
        { status: 500 }
      );
    }

    // Build query parameters from search params
    const queryParams = new URLSearchParams();
    
    // Vehicle filters
    if (searchParams.get('make')) queryParams.append('vehicle.make', searchParams.get('make')!);
    if (searchParams.get('model')) queryParams.append('vehicle.model', searchParams.get('model')!);
    if (searchParams.get('vehicle.trim')) queryParams.append('vehicle.trim', searchParams.get('vehicle.trim')!);
    // Handle year range (format: "2020-2024")
    const yearRange = searchParams.get('vehicle.year');
    if (yearRange) {
      queryParams.append('vehicle.year', yearRange);
    }
    if (searchParams.get('fuel')) queryParams.append('vehicle.fuel', searchParams.get('fuel')!);
    if (searchParams.get('fuelNot')) queryParams.append('vehicle.fuel.not', searchParams.get('fuelNot')!);
    
    // Retail listing filters
    if (searchParams.get('priceMin') || searchParams.get('priceMax')) {
      const priceMin = searchParams.get('priceMin') || '1';
      const priceMax = searchParams.get('priceMax') || '999999';
      queryParams.append('retailListing.price', `${priceMin}-${priceMax}`);
    }
    
    // ALWAYS filter for 0-100 miles (new cars that are potentially leasable)
    queryParams.append('retailListing.miles', '0-100');
    
    // Also allow user-specified mileage range if provided (but it will be overridden by 0-100)
    // This is kept for API compatibility but the 0-100 filter takes precedence
    
    if (searchParams.get('state')) queryParams.append('retailListing.state', searchParams.get('state')!);
    
    // Location filtering
    if (searchParams.get('zip')) queryParams.append('zip', searchParams.get('zip')!);
    if (searchParams.get('distance')) queryParams.append('distance', searchParams.get('distance')!);
    
    // Pagination
    if (searchParams.get('page')) queryParams.append('page', searchParams.get('page')!);
    if (searchParams.get('limit')) queryParams.append('limit', searchParams.get('limit')!);
    
    // VIN (if searching for specific vehicle)
    const vin = searchParams.get('vin');
    const endpoint = vin 
      ? `https://api.auto.dev/listings/${vin}`
      : `https://api.auto.dev/listings?${queryParams.toString()}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      return NextResponse.json(
        { error: errorData.error || 'Failed to fetch listings', code: errorData.code },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error searching listings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

