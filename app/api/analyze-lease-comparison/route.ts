import { NextRequest, NextResponse } from 'next/server';
import { LeaseData } from '@/lib/leaseData';

export async function POST(request: NextRequest) {
  try {
    const { cars, overrides, carOverrides, customPrompt } = await request.json();

    if (!cars || !Array.isArray(cars) || cars.length === 0) {
      return NextResponse.json(
        { error: 'At least one car is required for comparison' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { 
          error: 'OpenAI API key not configured. Please ensure OPENAI_API_KEY is set in your environment variables.',
          details: process.env.NODE_ENV === 'development' 
            ? 'Make sure you have a .env.local file with OPENAI_API_KEY'
            : 'Make sure OPENAI_API_KEY is configured in Vercel project settings and redeploy after adding it.'
        },
        { status: 500 }
      );
    }

    // Helper function to calculate lease metrics (matching ComparisonView logic)
    const calculateLeaseMetrics = (car: LeaseData, overrideDownPayment?: number, overrides?: any) => {
      const discount = overrides?.discount !== undefined ? overrides.discount : (car.discount || 0);
      const residualPercent = overrides?.residualPercent !== undefined ? overrides.residualPercent : car.residualPercent;
      
      let currentApr: number;
      if (overrides?.apr !== undefined) {
        currentApr = overrides.apr;
      } else if (overrides?.marketFactor !== undefined) {
        currentApr = overrides.marketFactor * 2400;
      } else {
        currentApr = car.apr || (car.marketFactor ? car.marketFactor * 2400 : 0);
      }
      
      const downPaymentOverride = overrides?.downPayment !== undefined ? overrides.downPayment : (overrideDownPayment !== undefined ? overrideDownPayment : (car.downPayment || 0));
      
      const baseCapCost = car.msrp * (1 - discount / 100);
      const totalFees = overrides?.totalFees !== undefined 
        ? overrides.totalFees
        : ((car.tagTitleFilingFees || 0) + (car.handlingFees || 0) + (car.otherFees || 0));
      const totalDownPayment = downPaymentOverride + (car.equityTransfer || 0) + (car.dueAtSigning || 0);
      const adjustedCapCost = baseCapCost + totalFees - totalDownPayment;
      const residualValue = (car.msrp * residualPercent) / 100;
      const depreciation = adjustedCapCost - residualValue;
      const monthlyDepreciation = depreciation / car.leaseTerm;
      const monthlyRate = currentApr / 100 / 12;
      const monthlyFinanceCharge = (adjustedCapCost + residualValue) * monthlyRate;
      const baseMonthlyPayment = monthlyDepreciation + monthlyFinanceCharge;
      const salesTaxMultiplier = 1 + (car.salesTaxPercent || 0) / 100;
      const totalMonthlyPayment = baseMonthlyPayment * salesTaxMultiplier;
      const totalLeaseCost = totalMonthlyPayment * car.leaseTerm;

      return {
        baseCapCost,
        totalFees,
        totalDownPayment,
        adjustedCapCost,
        residualValue,
        depreciation,
        monthlyDepreciation,
        monthlyFinanceCharge,
        totalMonthlyPayment,
        totalLeaseCost,
        currentApr,
      };
    };

    // Calculate lease metrics for each car
    const carsWithMetrics = cars.map((car: LeaseData) => {
      const overrideDownPaymentValue = overrides?.downPayment !== undefined ? overrides.downPayment : undefined;
      const carSpecificOverrides = carOverrides?.[car.id];
      const metrics = calculateLeaseMetrics(car, overrideDownPaymentValue, carSpecificOverrides);
      
      // Calculate expected residual for comparison
      const baseResidual = 60;
      const termAdjustment = (car.leaseTerm - 36) * 0.5;
      const expectedResidual = Math.max(0, Math.min(100, baseResidual - termAdjustment));
      const residualDifference = car.residualPercent - expectedResidual;

      return {
        vehicle: `${car.carMake} ${car.carModel}${car.carTier ? ` ${car.carTier}` : ''}`,
        dealership: car.dealership || 'Not specified',
        msrp: car.msrp,
        discount: car.discount || 0,
        discountAmount: car.msrp * ((car.discount || 0) / 100),
        baseCapCost: metrics.baseCapCost,
        totalFees: metrics.totalFees,
        totalDownPayment: metrics.totalDownPayment,
        adjustedCapCost: metrics.adjustedCapCost,
        residualPercent: car.residualPercent,
        residualValue: metrics.residualValue,
        expectedResidualPercent: expectedResidual,
        residualDifference: residualDifference,
        depreciation: metrics.depreciation,
        leaseTerm: car.leaseTerm,
        apr: metrics.currentApr,
        monthlyDepreciation: metrics.monthlyDepreciation,
        monthlyFinanceCharge: metrics.monthlyFinanceCharge,
        monthlyPayment: metrics.totalMonthlyPayment,
        totalLeaseCost: metrics.totalLeaseCost,
        salesTaxPercent: car.salesTaxPercent || 0,
      };
    });

    const overridesInfo = overrides ? {
      downPayment: overrides.downPayment !== undefined ? `$${overrides.downPayment.toLocaleString()}` : null,
    } : null;

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: `You are an expert automotive lease advisor. Analyze lease comparisons and provide clear, actionable insights. Consider:

FINANCIAL FACTORS:
- Total cost of lease (monthly payment × term)
- Depreciation amount and monthly depreciation
- Finance charges and APR
- Down payment impact (remember: down payments on leases don't build equity)
- Residual value percentage and its effect on monthly payment
- Total fees and their reasonableness (should be $500-$1,200 excluding tax)

LEASE-SPECIFIC FACTORS:
- Residual value percentage vs expected for lease term (36mo = ~60%, 48mo = ~54%, etc.)
- Whether residual is reasonable or inflated (compare to expectedResidualPercent)
- APR/Money Factor competitiveness
- Total fees (should be $500-$1,200 excluding tax)
- Down payment necessity (not required on leases, just reduces monthly)

NEGOTIATION FACTORS:
- Opportunities to negotiate price, fees, or APR
- Red flags (inflated residual, high fees, marked-up APR)
- Best value considering all lease factors
- Dealership tactics to watch for

REQUIRED OUTPUT FORMAT:
1. Start with a brief overview of the comparison
2. Provide a markdown table showing negotiation recommendations for EACH vehicle with:
   - Vehicle name
   - Current value vs recommended target
   - Priority (High/Medium/Low)
   - Specific negotiation strategy
   Columns: Vehicle | Parameter | Current | Target | Priority | Strategy
3. End with "Top 3 Recommendations" section listing the best 3 vehicles with:
   - Rank and vehicle name
   - Why it's recommended
   - Key advantages
   - Potential concerns

Be concise, practical, and objective. Format using markdown with clear sections, headers (##), tables, bullet points (-), and bold text (**).`,
          },
          {
            role: 'user',
            content: `Please analyze this lease comparison:

${JSON.stringify(carsWithMetrics, null, 2)}${overridesInfo ? `

IMPORTANT: This comparison uses standardized overrides applied to ALL vehicles:
${overridesInfo.downPayment ? `- Down Payment: ${overridesInfo.downPayment}` : ''}

All financial metrics are calculated using these standardized values for fair comparison.` : ''}${customPrompt ? `

ADDITIONAL USER REQUEST:
${customPrompt}` : ''}

Provide a comprehensive analysis with:
1. Brief overview
2. A markdown table showing negotiation recommendations for EACH vehicle (what to negotiate and target values)
3. Top 3 vehicle recommendations with detailed reasoning

Format the negotiation table as:
| Vehicle | Parameter | Current | Target | Priority | Strategy |
|---------|-----------|---------|--------|----------|----------|
| [Vehicle Name] | [e.g., Discount %, Residual %, APR, Fees] | [Current Value] | [Target Value] | High/Medium/Low | [Specific negotiation tip] |

Focus on actionable negotiation strategies for each vehicle.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      
      let errorMessage = 'Failed to analyze comparison';
      if (errorData.error) {
        if (errorData.error.code === 'insufficient_quota') {
          errorMessage = 'OpenAI API quota exceeded. Please check your billing at https://platform.openai.com/account/billing';
        } else if (errorData.error.code === 'invalid_api_key') {
          errorMessage = 'Invalid OpenAI API key. Please check your API key configuration.';
        } else if (errorData.error.message) {
          errorMessage = `OpenAI API error: ${errorData.error.message}`;
        }
      }
      
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    const data = await response.json();
    const analysis = data.choices[0].message.content;

    return NextResponse.json({
      success: true,
      analysis: analysis,
    });
  } catch (error) {
    console.error('Error analyzing lease comparison:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

