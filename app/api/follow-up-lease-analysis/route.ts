import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { previousAnalysis, question } = await request.json();

    if (!previousAnalysis || !question) {
      return NextResponse.json(
        { error: 'Previous analysis and question are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { 
          error: 'OpenAI API key not configured.',
          details: process.env.NODE_ENV === 'development' 
            ? 'Make sure you have a .env.local file with OPENAI_API_KEY'
            : 'Make sure OPENAI_API_KEY is configured in Vercel project settings.'
        },
        { status: 500 }
      );
    }

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
            content: 'You are an expert automotive lease advisor. Answer follow-up questions about lease analysis clearly and concisely. Reference the previous analysis when relevant. Format your response using markdown.',
          },
          {
            role: 'user',
            content: `Previous analysis:\n\n${previousAnalysis}\n\nFollow-up question: ${question}\n\nPlease answer the follow-up question based on the analysis above.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      
      let errorMessage = 'Failed to process follow-up question';
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
    console.error('Error processing follow-up question:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

