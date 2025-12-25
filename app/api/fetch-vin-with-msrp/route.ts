import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { vin, dealership } = await request.json();

    if (!vin || vin.length !== 17) {
      return NextResponse.json(
        { error: 'Please provide a valid 17-character VIN' },
        { status: 400 }
      );
    }

    // Step 1: Fetch VIN data from NHTSA API (free, no API key required)
    const vinResponse = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!vinResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch car details from NHTSA VIN decoder' },
        { status: vinResponse.status }
      );
    }

    const vinData = await vinResponse.json();
    
    if (!vinData.Results || vinData.Results.length === 0) {
      return NextResponse.json(
        { error: 'No vehicle data found for this VIN' },
        { status: 404 }
      );
    }

    const vehicle = vinData.Results[0];
    
    if (!vehicle.Make || !vehicle.Model || vehicle.Make === '' || vehicle.Model === '') {
      const errors: string[] = [];
      if (vehicle.ErrorCode && vehicle.ErrorCode !== '0' && vehicle.ErrorCode !== '') {
        const errorText = vehicle.ErrorText || `Error Code: ${vehicle.ErrorCode}`;
        errors.push(errorText);
      }
      if (vehicle.AdditionalErrorText && vehicle.AdditionalErrorText.trim() !== '') {
        errors.push(vehicle.AdditionalErrorText);
      }
      
      if (errors.length > 0) {
        return NextResponse.json(
          { error: errors.join('; ') },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: 'No vehicle data found for this VIN' },
        { status: 404 }
      );
    }

    // Extract vehicle information
    const make = vehicle.Make || '';
    const model = vehicle.Model || '';
    const year = vehicle.ModelYear ? parseInt(vehicle.ModelYear) : new Date().getFullYear();
    
    // Try to extract trim/tier from various fields
    let tier = '';
    if (vehicle.Trim) {
      tier = vehicle.Trim;
    } else if (vehicle.Series) {
      tier = vehicle.Series;
    } else if (vehicle.Trim2) {
      tier = vehicle.Trim2;
    }

    // Step 2: Use AI to search for MSRP
    const apiKey = process.env.OPENAI_API_KEY;
    let msrpEstimate: number | null = null;
    let msrpSource = '';

    if (apiKey) {
      try {
        const searchQuery = `${year} ${make} ${model}${tier ? ` ${tier}` : ''} MSRP price${dealership ? ` ${dealership}` : ''}`;
        
        const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are an expert automotive pricing assistant. Based on your knowledge of vehicle pricing, provide the MSRP (Manufacturer Suggested Retail Price) for the given vehicle. Use your knowledge of current market pricing, manufacturer pricing, and typical MSRP ranges for similar vehicles. Return only the MSRP number in dollars (no currency symbols, no commas, just the number). If you cannot provide a reliable estimate, return "NOT_FOUND".',
              },
              {
                role: 'user',
                content: `Find the MSRP (Manufacturer Suggested Retail Price) for this vehicle:
VIN: ${vin}
Year: ${year}
Make: ${make}
Model: ${model}
${tier ? `Trim/Tier: ${tier}` : ''}
${dealership ? `Dealership: ${dealership}` : ''}

Based on your knowledge of vehicle pricing, provide the MSRP for this specific vehicle configuration. Consider:
- Base MSRP for the make/model/year
- Trim/tier level pricing differences
- Typical MSRP ranges for this vehicle class
- Current market pricing trends

Return only the MSRP number in dollars (e.g., 35000 for $35,000). If you cannot provide a reliable estimate, return "NOT_FOUND".`,
              },
            ],
            temperature: 0.3,
            max_tokens: 100,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const aiContent = aiData.choices[0].message.content.trim();
          
          // Try to extract number from response
          const numberMatch = aiContent.match(/\d+/);
          if (numberMatch && aiContent !== 'NOT_FOUND') {
            msrpEstimate = parseInt(numberMatch[0]);
            msrpSource = 'AI Web Search';
          }
        }
      } catch (error) {
        console.error('Error fetching MSRP from AI:', error);
        // Continue without MSRP if AI fails
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        make: make,
        model: model,
        year: year,
        tier: tier,
        vin: vin,
        msrp: msrpEstimate,
        msrpSource: msrpSource,
        // Include additional VIN data
        bodyClass: vehicle.BodyClass || '',
        driveType: vehicle.DriveType || '',
        engineConfiguration: vehicle.EngineConfiguration || '',
        fuelType: vehicle.FuelTypePrimary || '',
        transmission: vehicle.TransmissionStyle || '',
      },
    });
  } catch (error) {
    console.error('Error fetching VIN with MSRP:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

