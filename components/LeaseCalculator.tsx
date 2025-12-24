'use client';

import { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface LeaseData {
  id: string;
  carMake: string;
  carModel: string;
  carTier: string;
  vin: string; // Vehicle Identification Number
  msrp: number;
  capCostPercent: number;
  discount: number; // Discount percentage (0-100)
  discountAmount: number; // Discount amount in dollars
  residualPercent: number;
  apr: number;
  marketFactor: number;
  leaseTerm: number;
  ficoScore8: number; // FICO Score 8 (300-850)
  salesTaxPercent: number; // Sales tax percentage
  tagTitleFilingFees: number; // Tag/title/filing fees
  handlingFees: number; // Handling fees (includes acquisition fee)
  otherFees: number; // Other miscellaneous fees
  downPayment: number; // Cash down payment
  equityTransfer: number; // Trade-in equity value
  dueAtSigning: number; // Total amount due at signing (reduces cap cost)
}

interface SavedCars {
  cars: LeaseData[];
  currentCarId: string | null;
}

const STORAGE_KEY = 'car-lease-calculator-data';

const createNewCar = (): LeaseData => ({
  id: Date.now().toString(),
  carMake: '',
  carModel: '',
  carTier: '',
  vin: '',
  msrp: 0,
  capCostPercent: 100,
  discount: 0, // 0% discount = 100% of MSRP
  discountAmount: 0, // Discount amount in dollars
  residualPercent: 60,
  apr: 0,
  marketFactor: 0,
  leaseTerm: 36,
  ficoScore8: 0,
  salesTaxPercent: 0,
  tagTitleFilingFees: 0,
  handlingFees: 700, // Default handling fee (includes acquisition fee)
  otherFees: 0,
  downPayment: 0,
  equityTransfer: 0,
  dueAtSigning: 0,
});

export default function LeaseCalculator() {
  const [savedCars, setSavedCars] = useState<SavedCars>({
    cars: [],
    currentCarId: null,
  });

  const [data, setData] = useState<LeaseData>(createNewCar());
  const isInitialLoad = useRef(true);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [isLoadingVIN, setIsLoadingVIN] = useState(false);
  const [vinError, setVinError] = useState<string | null>(null);
  const [vinSuccess, setVinSuccess] = useState<string | null>(null);
  const [vinData, setVinData] = useState<string>('');

  const [expandedSteps, setExpandedSteps] = useState({
    step1: true,
    step2: false,
    step3: false,
    step4: false,
    step5: false,
  });

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Handle migration from old format (single car) to new format (multiple cars)
        if (parsed.cars && Array.isArray(parsed.cars)) {
          // Migrate cars to include discount, discountAmount, and ficoScore8 fields if missing
          const migratedCars = parsed.cars.map((car: LeaseData) => {
            let updated = { ...car };
            if (car.discount === undefined) {
              // Calculate discount from capCostPercent: discount = (1 - capCostPercent/100) * 100
              const discount = (1 - car.capCostPercent / 100) * 100;
              updated = { ...updated, discount };
            }
            if (car.discountAmount === undefined) {
              // Calculate discountAmount from discount and MSRP
              const discount = updated.discount || 0;
              const discountAmount = (car.msrp * discount) / 100;
              updated = { ...updated, discountAmount };
            }
            if (car.ficoScore8 === undefined) {
              updated = { ...updated, ficoScore8: 0 };
            }
            if (car.salesTaxPercent === undefined) {
              updated = { ...updated, salesTaxPercent: 0 };
            }
            if (car.acquisitionFee === undefined) {
              updated = { ...updated, acquisitionFee: 700 };
            }
            // Migrate to new simplified fee structure
            if (car.tagTitleFilingFees === undefined) {
              // Combine registration, title, filing fees
              const registrationFee = car.registrationFee || 0;
              const titleFee = car.titleFee || 0;
              const licensePlateFee = car.licensePlateFee || 0;
              const titleAndDealerFees = car.titleAndDealerFees || 0;
              // If titleAndDealerFees exists, use it; otherwise sum individual fees
              // For tag/title/filing, we'll estimate: registration + title parts
              updated = { ...updated, tagTitleFilingFees: registrationFee + titleFee + licensePlateFee + (titleAndDealerFees * 0.6) };
            }
            if (car.handlingFees === undefined) {
              // Combine acquisition fee, documentation and dealer handling fees
              const acquisitionFee = car.acquisitionFee || 0;
              const documentationFee = car.documentationFee || 0;
              const dealerFee = car.dealerFee || 0;
              const titleAndDealerFees = car.titleAndDealerFees || 0;
              // If titleAndDealerFees exists, use dealer handling portion; otherwise sum
              updated = { ...updated, handlingFees: acquisitionFee + documentationFee + dealerFee + (titleAndDealerFees * 0.4) };
            }
            if (car.otherFees === undefined) {
              // Combine inspection, disposition, and other fees
              const inspectionFee = car.inspectionFee || 0;
              const dispositionFee = car.dispositionFee || 0;
              const oldOtherFees = car.otherFees || 0;
              updated = { ...updated, otherFees: inspectionFee + dispositionFee + oldOtherFees };
            }
            if (car.downPayment === undefined) {
              updated = { ...updated, downPayment: 0 };
            }
            if (car.equityTransfer === undefined) {
              updated = { ...updated, equityTransfer: 0 };
            }
            if (car.dueAtSigning === undefined) {
              updated = { ...updated, dueAtSigning: 0 };
            }
            if (car.vin === undefined) {
              updated = { ...updated, vin: '' };
            }
            return updated;
          });
          const migratedSavedCars = { ...parsed, cars: migratedCars };
          setSavedCars(migratedSavedCars);
          if (parsed.currentCarId && migratedCars.length > 0) {
            const currentCar = migratedCars.find((c: LeaseData) => c.id === parsed.currentCarId);
            if (currentCar) {
              setData(currentCar);
            } else {
              setData(migratedCars[0]);
              setSavedCars((prev) => ({ ...prev, currentCarId: migratedCars[0].id }));
            }
          } else if (migratedCars.length > 0) {
            setData(migratedCars[0]);
            setSavedCars((prev) => ({ ...prev, currentCarId: migratedCars[0].id }));
          }
        } else {
          // Old format - migrate to new format
          const discount = parsed.discount !== undefined ? parsed.discount : (1 - parsed.capCostPercent / 100) * 100;
          const discountAmount = parsed.discountAmount !== undefined ? parsed.discountAmount : (parsed.msrp * discount) / 100;
          const ficoScore8 = parsed.ficoScore8 !== undefined ? parsed.ficoScore8 : 0;
          const salesTaxPercent = parsed.salesTaxPercent !== undefined ? parsed.salesTaxPercent : 0;
          // Migrate to new simplified fee structure
          const acquisitionFee = parsed.acquisitionFee || 0;
          const registrationFee = parsed.registrationFee || 0;
          const titleFee = parsed.titleFee || 0;
          const licensePlateFee = parsed.licensePlateFee || 0;
          const titleAndDealerFees = parsed.titleAndDealerFees || 0;
          const tagTitleFilingFees = parsed.tagTitleFilingFees !== undefined ? parsed.tagTitleFilingFees :
            (registrationFee + titleFee + licensePlateFee + (titleAndDealerFees * 0.6));
          const documentationFee = parsed.documentationFee || 0;
          const dealerFee = parsed.dealerFee || 0;
          const handlingFees = parsed.handlingFees !== undefined ? parsed.handlingFees :
            (acquisitionFee + documentationFee + dealerFee + (titleAndDealerFees * 0.4));
          const inspectionFee = parsed.inspectionFee || 0;
          const dispositionFee = parsed.dispositionFee || 0;
          const oldOtherFees = parsed.otherFees || 0;
          const otherFees = parsed.otherFees !== undefined && parsed.inspectionFee === undefined && parsed.dispositionFee === undefined ? parsed.otherFees :
            (inspectionFee + dispositionFee + oldOtherFees);
          const downPayment = parsed.downPayment !== undefined ? parsed.downPayment : 0;
          const equityTransfer = parsed.equityTransfer !== undefined ? parsed.equityTransfer : 0;
          const dueAtSigning = parsed.dueAtSigning !== undefined ? parsed.dueAtSigning : 0;
          const vin = parsed.vin !== undefined ? parsed.vin : '';
          const migratedCar = { 
            ...parsed, 
            id: Date.now().toString(), 
            discount, 
            discountAmount, 
            ficoScore8,
            salesTaxPercent,
            tagTitleFilingFees,
            handlingFees,
            otherFees,
            downPayment,
            equityTransfer,
            dueAtSigning,
            vin,
          };
          const newSavedCars = {
            cars: [migratedCar],
            currentCarId: migratedCar.id,
          };
          setSavedCars(newSavedCars);
          setData(migratedCar);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newSavedCars));
        }
      } catch (e) {
        console.error('Failed to load from localStorage:', e);
      }
    } else {
      // No saved data - create a new car
      const newCar = createNewCar();
      const newSavedCars = {
        cars: [newCar],
        currentCarId: newCar.id,
      };
      setSavedCars(newSavedCars);
      setData(newCar);
    }
    isInitialLoad.current = false;
  }, []);

  // Save to localStorage when savedCars changes
  useEffect(() => {
    if (!isInitialLoad.current && savedCars.cars.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCars));
    }
  }, [savedCars]);

  const toggleStep = (step: keyof typeof expandedSteps) => {
    setExpandedSteps((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  const handleInputChange = (field: keyof LeaseData, value: string | number) => {
    setData((prev) => {
      const updated = { ...prev, [field]: value };
      // Update the car in savedCars array
      if (!isInitialLoad.current) {
        setSavedCars((prevSaved) => {
          if (prevSaved.cars.length > 0) {
            const updatedCars = prevSaved.cars.map((car) =>
              car.id === updated.id ? updated : car
            );
            return {
              ...prevSaved,
              cars: updatedCars,
            };
          }
          return prevSaved;
        });
      }
      return updated;
    });
  };

  const handleCarSelect = (carId: string) => {
    const selectedCar = savedCars.cars.find((c) => c.id === carId);
    if (selectedCar) {
      setData(selectedCar);
      setSavedCars((prev) => ({ ...prev, currentCarId: carId }));
    }
  };

  const handleAddNewCar = () => {
    const newCar = createNewCar();
    const updatedCars = [...savedCars.cars, newCar];
    setSavedCars({
      cars: updatedCars,
      currentCarId: newCar.id,
    });
    setData(newCar);
  };

  const handleDeleteCar = () => {
    if (savedCars.cars.length <= 1) {
      alert('Cannot delete the last car. Please add another car first.');
      return;
    }
    if (confirm('Are you sure you want to delete this car?')) {
      const updatedCars = savedCars.cars.filter((c) => c.id !== data.id);
      const newCurrentCarId = updatedCars[0].id;
      setSavedCars({
        cars: updatedCars,
        currentCarId: newCurrentCarId,
      });
      setData(updatedCars[0]);
    }
  };

  const handleSaveJSON = () => {
    const jsonStr = JSON.stringify(savedCars, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Generate filename from car name + unique ID
    const carName = getCarDisplayName(data);
    // Sanitize car name for filename (remove spaces, special chars, keep alphanumeric and hyphens)
    const sanitizedName = carName
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'car';
    
    // Use car ID as unique identifier, fallback to timestamp
    const uniqueId = data.id || Date.now();
    
    a.download = `${sanitizedName}-${uniqueId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const loaded = JSON.parse(event.target?.result as string);
            // Handle both old format (single car) and new format (multiple cars)
            if (loaded.cars && Array.isArray(loaded.cars)) {
              setSavedCars(loaded);
              if (loaded.currentCarId && loaded.cars.length > 0) {
                const currentCar = loaded.cars.find((c: LeaseData) => c.id === loaded.currentCarId);
                if (currentCar) {
                  setData(currentCar);
                } else {
                  setData(loaded.cars[0]);
                  setSavedCars((prev) => ({ ...prev, currentCarId: loaded.cars[0].id }));
                }
              } else if (loaded.cars.length > 0) {
                setData(loaded.cars[0]);
                setSavedCars((prev) => ({ ...prev, currentCarId: loaded.cars[0].id }));
              }
            } else {
              // Old format - migrate
              const discount = loaded.discount !== undefined ? loaded.discount : (1 - loaded.capCostPercent / 100) * 100;
              const discountAmount = loaded.discountAmount !== undefined ? loaded.discountAmount : (loaded.msrp * discount) / 100;
              const migratedCar = { ...loaded, id: Date.now().toString(), discount, discountAmount };
              const newSavedCars = {
                cars: [migratedCar],
                currentCarId: migratedCar.id,
              };
              setSavedCars(newSavedCars);
              setData(migratedCar);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(newSavedCars));
            }
          } catch (error) {
            alert('Failed to load JSON file. Please check the format.');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleExportPDF = async () => {
    if (!summaryRef.current) {
      alert('Please expand Step 5: Complete Summary to export PDF');
      return;
    }

    try {
      // Ensure the summary section is expanded
      if (!expandedSteps.step5) {
        setExpandedSteps((prev) => ({ ...prev, step5: true }));
        // Wait a bit for the DOM to update
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const element = summaryRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      const imgScaledWidth = imgWidth * ratio;
      const imgScaledHeight = imgHeight * ratio;
      
      // Center the image
      const xOffset = (pdfWidth - imgScaledWidth) / 2;
      const yOffset = 10;

      // Add title
      const carName = getCarDisplayName(data);
      pdf.setFontSize(18);
      pdf.text(`Lease Summary: ${carName}`, pdfWidth / 2, 15, { align: 'center' });
      
      // Add date
      pdf.setFontSize(10);
      pdf.text(`Generated: ${new Date().toLocaleDateString()}`, pdfWidth / 2, 22, { align: 'center' });

      // Add the summary image
      pdf.addImage(imgData, 'PNG', xOffset, yOffset + 5, imgScaledWidth, imgScaledHeight);

      // Generate filename
      const sanitizedName = carName
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'car';
      const uniqueId = data.id || Date.now();
      
      pdf.save(`${sanitizedName}-summary-${uniqueId}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    }
  };

  const handleFetchVINData = async () => {
    if (!data.vin || data.vin.length !== 17) {
      setVinError('Please enter a valid 17-character VIN');
      return;
    }

    setIsLoadingVIN(true);
    setVinError(null);
    setVinSuccess(null);

    try {
      // Fetch VIN data from NHTSA API (free, no API key required)
      const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${data.vin}?format=json`);
      const result = await response.json();

      if (result.Results && result.Results.length > 0) {
        const vinDataArray = result.Results;
        
        // Check if VIN decode was successful
        const hasError = vinDataArray.some((item: any) => item.ErrorCode && item.ErrorCode !== '0' && item.ErrorCode !== '');
        if (hasError) {
          setVinError('Invalid VIN or unable to decode. Please verify the VIN is correct.');
          setIsLoadingVIN(false);
          return;
        }
        
        // Extract vehicle information
        const vinData = vinDataArray[0];
        const make = vinData.Make || '';
        const model = vinData.Model || '';
        const modelYear = vinData.ModelYear || '';
        const trim = vinData.Trim || vinData.Series || '';
        
        // Format all retrieved data as readable text
        const formattedData: string[] = [];
        formattedData.push(`VIN: ${data.vin}`);
        formattedData.push(`Decoded on: ${new Date().toLocaleString()}`);
        formattedData.push('');
        formattedData.push('=== PRICING INFORMATION ===');
        formattedData.push('MSRP: [To be fetched or entered manually]');
        formattedData.push('Median Dealership Sold Price: [To be fetched or entered manually]');
        formattedData.push('');
        formattedData.push('💡 To find MSRP and median sold price:');
        formattedData.push('   • Check manufacturer website or window sticker');
        formattedData.push('   • Visit Edmunds.com True Market Value (TMV)');
        formattedData.push('   • Check Kelley Blue Book (KBB.com)');
        formattedData.push('   • Search CarGurus or AutoTrader for similar vehicles');
        formattedData.push('');
        formattedData.push('=== Vehicle Information ===');
        
        // Extract and format all relevant fields
        const fields = [
          { key: 'Make', label: 'Make' },
          { key: 'Model', label: 'Model' },
          { key: 'ModelYear', label: 'Model Year' },
          { key: 'Trim', label: 'Trim' },
          { key: 'Series', label: 'Series' },
          { key: 'BodyClass', label: 'Body Class' },
          { key: 'DriveType', label: 'Drive Type' },
          { key: 'EngineConfiguration', label: 'Engine Configuration' },
          { key: 'EngineCylinders', label: 'Engine Cylinders' },
          { key: 'EngineModel', label: 'Engine Model' },
          { key: 'FuelTypePrimary', label: 'Fuel Type' },
          { key: 'TransmissionStyle', label: 'Transmission' },
          { key: 'GVWR', label: 'GVWR' },
          { key: 'PlantCountry', label: 'Manufacturing Country' },
          { key: 'PlantCity', label: 'Manufacturing City' },
          { key: 'PlantState', label: 'Manufacturing State' },
          { key: 'PlantCompanyName', label: 'Manufacturing Company' },
        ];
        
        fields.forEach(({ key, label }) => {
          const value = vinData[key];
          if (value && value !== 'Not Applicable' && value !== '') {
            formattedData.push(`${label}: ${value}`);
          }
        });
        
        formattedData.push('');
        formattedData.push('=== Additional Details ===');
        
        // Add any other non-empty fields
        Object.keys(vinData).forEach((key) => {
          const value = vinData[key];
          if (value && 
              value !== 'Not Applicable' && 
              value !== '' && 
              !fields.some(f => f.key === key) &&
              key !== 'ErrorCode' &&
              key !== 'ErrorText') {
            formattedData.push(`${key}: ${value}`);
          }
        });
        
        // Add pricing information to formatted data
        const searchQuery = `${modelYear} ${make} ${model} ${trim}`.trim();
        formattedData.push('');
        formattedData.push('=== PRICING INFORMATION ===');
        formattedData.push('MSRP: [Enter manually or check manufacturer website/window sticker]');
        formattedData.push('Median Dealership Sold Price: [Check pricing websites below]');
        formattedData.push('');
        formattedData.push('💡 To find MSRP and median sold price, check these sources:');
        formattedData.push(`   • Manufacturer website or window sticker`);
        formattedData.push(`   • Edmunds TMV: https://www.edmunds.com/tmv.html (Search: ${searchQuery})`);
        formattedData.push(`   • KBB Price Advisor: https://www.kbb.com/priceadvisor/ (Search: ${searchQuery})`);
        formattedData.push(`   • CarGurus: Search for ${searchQuery}`);
        
        const formattedText = formattedData.join('\n');
        setVinData(formattedText);
        setVinError(null);
        setVinSuccess('Vehicle information retrieved! Check pricing links above for MSRP and median sold price.');
        
        // Clear success message after 8 seconds
        setTimeout(() => {
          setVinSuccess(null);
        }, 8000);
      } else {
        setVinError('Unable to decode VIN. Please verify the VIN is correct.');
      }
    } catch (error) {
      console.error('Error fetching VIN data:', error);
      setVinError('Failed to fetch vehicle information. Please check your internet connection and try again.');
    } finally {
      setIsLoadingVIN(false);
    }
  };

  const getCarDisplayName = (car: LeaseData): string => {
    if (car.carMake && car.carModel) {
      return `${car.carMake} ${car.carModel}${car.carTier ? ` ${car.carTier}` : ''}`;
    }
    return 'New Car';
  };

  // Calculate cap costs for different discount percentages - dynamic range based on entered value
  const getCapCosts = () => {
    const enteredDiscount = data.discount || 0;
    const range = 20; // Show ±20% range
    const step = 5; // 5% increments
    
    // Calculate min and max discount, ensuring they don't go below 0 or above 100
    const min = Math.max(0, Math.floor(enteredDiscount / step) * step - range);
    const max = Math.min(100, Math.ceil(enteredDiscount / step) * step + range);
    
    const discounts = [];
    for (let i = min; i <= max; i += step) {
      discounts.push(i);
    }
    
    return discounts.map((discount) => {
      const capCostPercent = (1 - discount / 100) * 100;
      const discountAmount = (data.msrp * discount) / 100;
      const capCost = data.msrp * (1 - discount / 100);
      return {
        discount,
        discountAmount,
        capCostPercent,
        capCost,
      };
    });
  };

  // Calculate technical residual value based on term length
  const getTechnicalResidualValue = (): number => {
    // Technical residual = (60 - (term - 36) * 0.5)%
    // This gives: 36mo = 60%, 39mo = 58.5%, 48mo = 54%, etc.
    const baseResidual = 60;
    const termAdjustment = (data.leaseTerm - 36) * 0.5;
    return Math.max(0, Math.min(100, baseResidual - termAdjustment));
  };

  // Calculate ideal range based on term length
  const getIdealResidualRange = (): { min: number; max: number } => {
    const technical = getTechnicalResidualValue();
    // Ideal range is ±2% around technical value
    return {
      min: Math.max(0, technical - 2),
      max: Math.min(100, technical + 2),
    };
  };

  // Get FICO Score 8 recommendations
  const getFicoRecommendations = () => {
    const score = data.ficoScore8 || 0;
    
    if (score === 0) {
      return {
        tier: 'Not Entered',
        color: 'gray',
        expectedAprRange: 'N/A',
        expectedMoneyFactorRange: 'N/A',
        recommendations: ['Enter your FICO Score 8 to get personalized lease recommendations'],
        approvalLikelihood: 'Unknown',
      };
    }
    
    if (score >= 781) {
      return {
        tier: 'Super Prime',
        color: 'green',
        expectedAprRange: '2.5% - 4.5%',
        expectedMoneyFactorRange: '0.0010 - 0.0019',
        recommendations: [
          'Excellent credit! You qualify for the best lease rates available',
          'Negotiate for money factor below 0.0015 for optimal deals',
          'Consider shorter lease terms (24-36 months) for better residual values',
          'You may qualify for special manufacturer incentives and rebates',
          'Shop multiple dealerships to leverage your strong credit',
        ],
        approvalLikelihood: 'Very High',
      };
    } else if (score >= 740) {
      return {
        tier: 'Very Good',
        color: 'blue',
        expectedAprRange: '3.5% - 5.5%',
        expectedMoneyFactorRange: '0.0015 - 0.0023',
        recommendations: [
          'Strong credit score - you should get competitive lease rates',
          'Aim for money factor between 0.0015-0.0020 for best deals',
          'Consider 36-month leases for optimal residual values',
          'Shop around - you have leverage to negotiate favorable terms',
          'Manufacturer specials may be available to you',
        ],
        approvalLikelihood: 'High',
      };
    } else if (score >= 670) {
      return {
        tier: 'Good',
        color: 'yellow',
        expectedAprRange: '5.0% - 7.5%',
        expectedMoneyFactorRange: '0.0021 - 0.0031',
        recommendations: [
          'Good credit - you should qualify for standard lease rates',
          'Target money factor around 0.0025 or lower if possible',
          'Consider larger down payment to improve overall terms',
          '36-39 month leases typically offer best value',
          'Compare offers from multiple lenders',
        ],
        approvalLikelihood: 'Good',
      };
    } else if (score >= 580) {
      return {
        tier: 'Fair',
        color: 'orange',
        expectedAprRange: '7.5% - 11.0%',
        expectedMoneyFactorRange: '0.0031 - 0.0046',
        recommendations: [
          'Fair credit - lease approval possible but rates will be higher',
          'Expect money factor between 0.0035-0.0045',
          'Consider larger down payment or security deposit to improve terms',
          'Longer lease terms (48 months) may help with approval',
          'Work on improving credit score before leasing if possible',
          'Shop subprime-friendly lenders if needed',
        ],
        approvalLikelihood: 'Moderate',
      };
    } else {
      return {
        tier: 'Poor',
        color: 'red',
        expectedAprRange: '11.0%+',
        expectedMoneyFactorRange: '0.0046+',
        recommendations: [
          'Credit score may significantly limit lease options',
          'Expect money factor above 0.0050 or possible denial',
          'Large down payment or security deposit likely required',
          'Consider subprime leasing programs if available',
          'Strongly consider improving credit score before leasing',
          'Alternative: Consider financing instead of leasing',
          'Some lenders may not approve leases with scores below 580',
        ],
        approvalLikelihood: 'Low',
      };
    }
  };

  // Calculate residual values for different percentages - dynamic range based on entered value
  const getResidualValues = () => {
    const enteredPercent = data.residualPercent;
    const range = 5; // Show ±5% range
    const step = 1; // 1% increments
    
    // Calculate min and max, ensuring they don't go below 0
    const min = Math.max(0, Math.floor(enteredPercent / step) * step - range);
    const max = Math.ceil(enteredPercent / step) * step + range;
    
    const percentages = [];
    for (let i = min; i <= max; i += step) {
      percentages.push(i);
    }
    
    const selectedCapCost = (data.msrp * data.capCostPercent) / 100;
    return percentages.map((percent) => ({
      percent,
      residualValue: (data.msrp * percent) / 100,
      depreciation: selectedCapCost - (data.msrp * percent) / 100,
    }));
  };

  // Calculate monthly payments for different APR/Money Factor
  const getMonthlyPayments = () => {
    // Base cap cost after discount
    const baseCapCost = data.msrp * (1 - (data.discount || 0) / 100);
    
    // Add all fees to cap cost
    const totalFees = 
      (data.tagTitleFilingFees || 0) +
      (data.handlingFees || 0) +
      (data.otherFees || 0);
    
    // Subtract down payment, equity transfer, and due at signing
    const totalDownPayment = (data.downPayment || 0) + (data.equityTransfer || 0) + (data.dueAtSigning || 0);
    
    // Adjusted cap cost (base + fees - down payment/equity/due at signing)
    const adjustedCapCost = baseCapCost + totalFees - totalDownPayment;
    
    const residualValue = (data.msrp * data.residualPercent) / 100;
    const depreciation = adjustedCapCost - residualValue;
    const monthlyDepreciation = depreciation / data.leaseTerm;

    // Calculate current APR from money factor if needed
    const currentApr = data.apr || (data.marketFactor ? data.marketFactor * 2400 : 0);
    const currentMoneyFactor = data.marketFactor || (data.apr ? data.apr / 2400 : 0);

    const rates = [];
    
    // Generate APR range: ±5% from entered APR, in 0.5% increments
    // If no APR entered, default to 0-10% range
    const baseApr = currentApr || 5; // Default to 5% if nothing entered
    const startApr = Math.max(0, baseApr - 5);
    const endApr = baseApr + 5;
    const step = 0.5;

    for (let i = startApr; i <= endApr; i += step) {
      const monthlyRate = i / 100 / 12; // APR-based
      const monthlyFinanceCharge = (adjustedCapCost + residualValue) * monthlyRate;
      const baseMonthlyPayment = monthlyDepreciation + monthlyFinanceCharge;
      
      // Apply sales tax to monthly payment
      const salesTaxMultiplier = 1 + (data.salesTaxPercent || 0) / 100;
      const totalMonthlyPayment = baseMonthlyPayment * salesTaxMultiplier;

      rates.push({
        apr: i,
        moneyFactor: i / 2400,
        monthlyRate,
        monthlyDepreciation,
        monthlyFinanceCharge,
        baseMonthlyPayment,
        totalMonthlyPayment,
      });
    }

    // Ensure the exact entered APR is included if not already in the range
    if (currentApr > 0 && !rates.some(r => Math.abs(r.apr - currentApr) < 0.01)) {
      const monthlyRate = currentApr / 100 / 12;
      const monthlyFinanceCharge = (adjustedCapCost + residualValue) * monthlyRate;
      const baseMonthlyPayment = monthlyDepreciation + monthlyFinanceCharge;
      const salesTaxMultiplier = 1 + (data.salesTaxPercent || 0) / 100;
      const totalMonthlyPayment = baseMonthlyPayment * salesTaxMultiplier;
      rates.push({
        apr: currentApr,
        moneyFactor: currentMoneyFactor,
        monthlyRate,
        monthlyDepreciation,
        monthlyFinanceCharge,
        baseMonthlyPayment,
        totalMonthlyPayment,
        isEntered: true,
      });
      rates.sort((a, b) => a.apr - b.apr); // Sort to maintain order
    }

    return {
      baseCapCost,
      adjustedCapCost,
      totalFees,
      totalDownPayment,
      residualValue,
      depreciation,
      currentApr,
      currentMoneyFactor,
      rates,
    };
  };

  const paymentData = getMonthlyPayments();

  return (
    <div className="space-y-6">
      {/* Car Selection and Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Select Car
        </label>
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <select
            value={data.id}
            onChange={(e) => handleCarSelect(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            {savedCars.cars.map((car) => (
              <option key={car.id} value={car.id}>
                {getCarDisplayName(car)}
              </option>
            ))}
          </select>
          <button
            onClick={handleAddNewCar}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap"
            title="Add New Car"
          >
            + New Car
          </button>
          {savedCars.cars.length > 1 && (
            <button
              onClick={handleDeleteCar}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap"
              title="Delete Current Car"
            >
              Delete
            </button>
          )}
          <div className="flex gap-2 md:ml-auto">
            <button
              onClick={handleSaveJSON}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              Save as JSON
            </button>
            <button
              onClick={handleLoadJSON}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors whitespace-nowrap"
            >
              Load JSON
            </button>
          </div>
        </div>
      </div>

      {/* Car Details */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Car Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Car Make
            </label>
            <input
              type="text"
              value={data.carMake}
              onChange={(e) => handleInputChange('carMake', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., Toyota"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Car Model
            </label>
            <input
              type="text"
              value={data.carModel}
              onChange={(e) => handleInputChange('carModel', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., Camry"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Car Tier
            </label>
            <input
              type="text"
              value={data.carTier}
              onChange={(e) => handleInputChange('carTier', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., LE, XLE"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              VIN (Vehicle Identification Number)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={data.vin}
                onChange={(e) => {
                  handleInputChange('vin', e.target.value.toUpperCase());
                  setVinError(null);
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono"
                placeholder="e.g., 1HGBH41JXMN109186"
                maxLength={17}
              />
              <button
                onClick={handleFetchVINData}
                disabled={!data.vin || data.vin.length !== 17 || isLoadingVIN}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                title="Fetch vehicle information from VIN"
              >
                {isLoadingVIN ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Fetch Info
                  </>
                )}
              </button>
            </div>
            {vinError && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                {vinError}
              </p>
            )}
            {vinSuccess && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                {vinSuccess}
              </p>
            )}
            {!vinError && !vinSuccess && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Enter the 17-character VIN and click "Fetch Info" to retrieve vehicle information
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              MSRP ($)
            </label>
            <input
              type="number"
              value={data.msrp || ''}
              onChange={(e) => handleInputChange('msrp', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., 35000"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Lease Term (months)
            </label>
            <select
              value={data.leaseTerm}
              onChange={(e) => handleInputChange('leaseTerm', parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value={12}>12 months</option>
              <option value={24}>24 months</option>
              <option value={36}>36 months</option>
              <option value={39}>39 months</option>
              <option value={48}>48 months</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Technical Residual: {getTechnicalResidualValue().toFixed(1)}% | Ideal Range: {getIdealResidualRange().min.toFixed(1)}% - {getIdealResidualRange().max.toFixed(1)}%
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              FICO Score 8 (Auto)
            </label>
            <input
              type="number"
              min="300"
              max="850"
              step="1"
              value={data.ficoScore8 || ''}
              onChange={(e) => handleInputChange('ficoScore8', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., 750"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Enter your FICO Score 8 for personalized lease recommendations
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Sales Tax (%)
            </label>
            <input
              type="number"
              min="0"
              max="15"
              step="0.01"
              value={data.salesTaxPercent || ''}
              onChange={(e) => handleInputChange('salesTaxPercent', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., 7.5"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Enter your local sales tax percentage
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Down Payment ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={data.downPayment || ''}
              onChange={(e) => handleInputChange('downPayment', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., 2000"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Cash down payment amount
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Equity Transfer / Trade-In Value ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={data.equityTransfer || ''}
              onChange={(e) => handleInputChange('equityTransfer', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., 5000"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Trade-in equity value applied to lease
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Due at Signing ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={data.dueAtSigning || ''}
              onChange={(e) => handleInputChange('dueAtSigning', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder="e.g., 3000"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Total amount due at signing (reduces monthly payment)
            </p>
          </div>
        </div>
        {data.ficoScore8 > 0 && (
          <div className={`mt-4 p-4 rounded-lg border-2 ${
            getFicoRecommendations().color === 'green' ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' :
            getFicoRecommendations().color === 'blue' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' :
            getFicoRecommendations().color === 'yellow' ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700' :
            getFicoRecommendations().color === 'orange' ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700' :
            'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Credit Tier: {getFicoRecommendations().tier} ({data.ficoScore8})
              </h3>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                getFicoRecommendations().approvalLikelihood === 'Very High' || getFicoRecommendations().approvalLikelihood === 'High' ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200' :
                getFicoRecommendations().approvalLikelihood === 'Good' ? 'bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200' :
                getFicoRecommendations().approvalLikelihood === 'Moderate' ? 'bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200' :
                'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
              }`}>
                Approval: {getFicoRecommendations().approvalLikelihood}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected APR Range:</p>
                <p className="text-sm text-gray-900 dark:text-white font-semibold">{getFicoRecommendations().expectedAprRange}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected Money Factor Range:</p>
                <p className="text-sm text-gray-900 dark:text-white font-semibold">{getFicoRecommendations().expectedMoneyFactorRange}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Recommendations:</p>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-800 dark:text-gray-200">
                {getFicoRecommendations().recommendations.map((rec, index) => (
                  <li key={index}>{rec}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {vinData && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Retrieved Vehicle Information
            </label>
            <textarea
              value={vinData}
              onChange={(e) => setVinData(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 font-mono text-sm"
              rows={15}
              placeholder="Vehicle information will appear here after fetching..."
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              You can edit this information or copy it for reference. This data is not automatically saved.
            </p>
          </div>
        )}
      </div>

      {/* Step 1: Cap Cost */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={() => toggleStep('step1')}
          className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Step 1: Discount & Cap Cost Preview
          </h2>
          <span className="text-2xl text-gray-500 dark:text-gray-400">
            {expandedSteps.step1 ? '−' : '+'}
          </span>
        </button>
        {expandedSteps.step1 && (
          <div className="px-6 pb-6">
            <div className="mb-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Discount Percentage:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={data.discount || 0}
                      onChange={(e) => {
                        const discount = parseFloat(e.target.value) || 0;
                        const discountAmount = (data.msrp * discount) / 100;
                        const capCostPercent = (1 - discount / 100) * 100;
                        setData((prev) => ({ ...prev, discount, discountAmount, capCostPercent }));
                      }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">%</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Discount Amount:
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={data.discountAmount || 0}
                      onChange={(e) => {
                        const discountAmount = parseFloat(e.target.value) || 0;
                        const discount = data.msrp > 0 ? (discountAmount / data.msrp) * 100 : 0;
                        const capCostPercent = (1 - discount / 100) * 100;
                        setData((prev) => ({ ...prev, discount, discountAmount, capCostPercent }));
                      }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Cap Cost: ${((data.msrp * (1 - (data.discount || 0) / 100))).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={data.discount || 0}
                  onChange={(e) => {
                    const discount = parseFloat(e.target.value) || 0;
                    const discountAmount = (data.msrp * discount) / 100;
                    const capCostPercent = (1 - discount / 100) * 100;
                    setData((prev) => ({ ...prev, discount, discountAmount, capCostPercent }));
                  }}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-700">
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Discount %
                    </th>
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Discount Amount ($)
                    </th>
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Cap Cost ($)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const capCosts = getCapCosts();
                    const enteredDiscount = data.discount || 0;
                    const step = 5;
                    
                    // Check if entered value falls between two table rows
                    const lowerBound = Math.floor(enteredDiscount / step) * step;
                    const upperBound = Math.ceil(enteredDiscount / step) * step;
                    const isBetweenRows = enteredDiscount > 0 && 
                                         enteredDiscount !== lowerBound && 
                                         enteredDiscount !== upperBound &&
                                         lowerBound !== upperBound;
                    
                    // Create interpolated row if needed
                    const interpolatedRow = isBetweenRows ? {
                      discount: enteredDiscount,
                      discountAmount: (data.msrp * enteredDiscount) / 100,
                      capCostPercent: (1 - enteredDiscount / 100) * 100,
                      capCost: data.msrp * (1 - enteredDiscount / 100),
                      isInterpolated: true,
                    } : null;
                    
                    // Build rows array with interpolated row inserted at correct position
                    const rows: Array<typeof capCosts[0] & { isInterpolated?: boolean }> = [];
                    
                    capCosts.forEach((item, index) => {
                      // Insert interpolated row before the upper bound
                      if (interpolatedRow && 
                          item.discount === upperBound && 
                          capCosts[index - 1]?.discount === lowerBound &&
                          !rows.some(r => r.isInterpolated)) {
                        rows.push(interpolatedRow);
                      }
                      rows.push(item);
                    });
                    
                    return rows.map((item) => {
                      const isSelected = Math.abs(item.discount - enteredDiscount) < 0.1 || 
                                        Math.abs(item.discountAmount - (data.discountAmount || 0)) < 0.01;
                      const isInterpolated = item.isInterpolated;
                      
                      let rowClass = 'hover:bg-gray-50 dark:hover:bg-gray-700';
                      if (isSelected && !isInterpolated) {
                        rowClass = 'bg-blue-100 dark:bg-blue-900';
                      } else if (isInterpolated) {
                        rowClass = 'bg-yellow-100 dark:bg-yellow-900/40 hover:bg-yellow-200 dark:hover:bg-yellow-900/60 cursor-pointer';
                      }
                      
                      return (
                        <tr
                          key={isInterpolated ? `interpolated-${item.discount}` : item.discount}
                          className={rowClass}
                          onClick={isInterpolated ? () => {
                            const discount = item.discount;
                            const discountAmount = item.discountAmount;
                            const capCostPercent = item.capCostPercent;
                            setData((prev) => ({ ...prev, discount, discountAmount, capCostPercent }));
                          } : undefined}
                          title={isInterpolated ? 'Click to set this value' : undefined}
                        >
                          <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white font-semibold">
                            {item.discount.toFixed(1)}%
                            {isInterpolated && (
                              <span className="ml-2 text-xs text-yellow-600 dark:text-yellow-400 font-semibold">
                                ← Entered
                              </span>
                            )}
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white">
                            ${item.discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white">
                            ${item.capCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Residual Value */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={() => toggleStep('step2')}
          className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Step 2: Residual Value Preview
          </h2>
          <span className="text-2xl text-gray-500 dark:text-gray-400">
            {expandedSteps.step2 ? '−' : '+'}
          </span>
        </button>
        {expandedSteps.step2 && (
          <div className="px-6 pb-6">
            <div className="mb-4">
              <div>
                <div className="flex items-center gap-4 mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Residual Value Percentage:
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={data.residualPercent}
                    onChange={(e) => handleInputChange('residualPercent', parseFloat(e.target.value) || 0)}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={data.residualPercent}
                  onChange={(e) => handleInputChange('residualPercent', parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-700">
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Residual %
                    </th>
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Residual Value ($)
                    </th>
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Depreciation ($)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const residualValues = getResidualValues();
                    const technicalResidual = getTechnicalResidualValue();
                    const idealRange = getIdealResidualRange();
                    
                    return residualValues.map((item) => {
                      const isSelected = Math.abs(item.percent - data.residualPercent) < 0.1;
                      const isTechnical = Math.abs(item.percent - technicalResidual) < 0.1;
                      const isIdealRange = item.percent >= idealRange.min && item.percent <= idealRange.max && !isTechnical;
                      let rowClass = 'hover:bg-gray-50 dark:hover:bg-gray-700';
                      
                      if (isSelected) {
                        rowClass = 'bg-blue-100 dark:bg-blue-900';
                      } else if (isTechnical) {
                        rowClass = 'bg-purple-100 dark:bg-purple-900/40 hover:bg-purple-200 dark:hover:bg-purple-900/60';
                      } else if (isIdealRange) {
                        rowClass = 'bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/40';
                      }
                      
                      return (
                        <tr key={item.percent} className={rowClass}>
                          <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white">
                            {item.percent}%
                            {isTechnical && (
                              <span className="ml-2 text-xs text-purple-600 dark:text-purple-400 font-semibold">
                                ⚡ Technical ({data.leaseTerm}mo)
                              </span>
                            )}
                            {isIdealRange && (
                              <span className="ml-2 text-xs text-green-600 dark:text-green-400 font-semibold">
                                ✓ Ideal Range
                              </span>
                            )}
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white">
                            ${item.residualValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white">
                            ${item.depreciation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Step 3: APR/Market Factor */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={() => toggleStep('step3')}
          className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Step 3: APR/Market Factor Preview
          </h2>
          <span className="text-2xl text-gray-500 dark:text-gray-400">
            {expandedSteps.step3 ? '−' : '+'}
          </span>
        </button>
        {expandedSteps.step3 && (
          <div className="px-6 pb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  APR (%)
                </label>
                <input
                  type="number"
                  value={data.apr || ''}
                  onChange={(e) => {
                    const apr = parseFloat(e.target.value) || 0;
                    const moneyFactor = apr / 2400;
                    setData((prev) => ({ ...prev, apr, marketFactor: moneyFactor }));
                  }}
                  step="0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="e.g., 2.5"
                />
                {data.marketFactor > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Money Factor: {data.marketFactor.toFixed(4)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Money Factor
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.0001"
                  value={data.marketFactor !== undefined && data.marketFactor !== null ? data.marketFactor : ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || value === null || value === undefined) {
                      setData((prev) => ({ ...prev, marketFactor: 0, apr: 0 }));
                      return;
                    }
                    const moneyFactor = parseFloat(value);
                    if (!isNaN(moneyFactor)) {
                      const apr = moneyFactor * 2400;
                      setData((prev) => ({ ...prev, marketFactor: moneyFactor, apr }));
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="e.g., 0.00125"
                />
                {data.apr > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    APR: {data.apr.toFixed(2)}%
                  </p>
                )}
              </div>
            </div>
            <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Adjusted Cap Cost:</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    ${paymentData.adjustedCapCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                      ({data.discount ? `-${data.discount.toFixed(1)}%` : '0%'} discount)
                    </span>
                  </p>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Residual Value:</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    ${paymentData.residualValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Depreciation:</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    ${paymentData.depreciation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400">Monthly Depreciation:</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    ${paymentData.rates[0]?.monthlyDepreciation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                  </p>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-700">
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      APR (%)
                    </th>
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Money Factor
                    </th>
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Monthly Finance Charge ($)
                    </th>
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left text-gray-900 dark:text-white">
                      Total Monthly Payment ($)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paymentData.rates.map((rate) => {
                    const isSelected = Math.abs(rate.apr - paymentData.currentApr) < 0.01;
                    return (
                      <tr
                        key={rate.apr}
                        onClick={() => {
                          setData((prev) => ({
                            ...prev,
                            apr: rate.apr,
                            marketFactor: rate.moneyFactor,
                          }));
                        }}
                        className={
                          isSelected
                            ? 'bg-blue-100 dark:bg-blue-900 cursor-pointer'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
                        }
                      >
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white">
                          {rate.apr.toFixed(1)}%
                          {isSelected && (
                            <span className="ml-2 text-xs text-blue-600 dark:text-blue-400 font-semibold">
                              ← Selected
                            </span>
                          )}
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white">
                          {rate.moneyFactor.toFixed(5)}
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white">
                          ${rate.monthlyFinanceCharge.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 font-semibold text-gray-900 dark:text-white">
                          ${rate.totalMonthlyPayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Step 4: Fees */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={() => toggleStep('step4')}
          className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Step 4: Fees & Additional Costs
          </h2>
          <span className="text-2xl text-gray-500 dark:text-gray-400">
            {expandedSteps.step4 ? '−' : '+'}
          </span>
        </button>
        {expandedSteps.step4 && (
          <div className="px-6 pb-6">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Tag/Title/Filing Fees ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={data.tagTitleFilingFees || ''}
                    onChange={(e) => handleInputChange('tagTitleFilingFees', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="e.g., 300"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Tag, title, and filing fees
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Handling Fees ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={data.handlingFees || ''}
                    onChange={(e) => handleInputChange('handlingFees', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="e.g., 700"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Handling fees (includes acquisition fee, typically $700)
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Other Fees ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={data.otherFees || ''}
                    onChange={(e) => handleInputChange('otherFees', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="e.g., 200"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Any other miscellaneous fees
                  </p>
                </div>
              </div>
              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Total Fees Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tag/Title/Filing Fees:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${(data.tagTitleFilingFees || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Handling Fees:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${(data.handlingFees || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Other Fees:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${(data.otherFees || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-300 dark:border-gray-600 font-semibold">
                    <span className="text-gray-900 dark:text-white">Total Fees:</span>
                    <span className="text-gray-900 dark:text-white">
                      ${paymentData.totalFees.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Step 5: Complete Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
        <button
          onClick={() => toggleStep('step5')}
          className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Step 5: Complete Summary
          </h2>
          <span className="text-2xl text-gray-500 dark:text-gray-400">
            {expandedSteps.step5 ? '−' : '+'}
          </span>
        </button>
        {expandedSteps.step5 && (
          <div className="px-6 pb-6">
            <div className="mb-4 flex justify-end">
              <button
                onClick={handleExportPDF}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Export to PDF
              </button>
            </div>
            <div ref={summaryRef} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Vehicle Information</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Make:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{data.carMake || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Model:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{data.carModel || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tier:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{data.carTier || 'N/A'}</span>
                  </div>
                  {data.vin && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">VIN:</span>
                      <span className="font-medium text-gray-900 dark:text-white font-mono">{data.vin}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">MSRP:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${data.msrp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Lease Terms</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Base Cap Cost:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${paymentData.baseCapCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({data.capCostPercent}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Total Fees:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${paymentData.totalFees.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Down Payment:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${(data.downPayment || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Equity Transfer:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${(data.equityTransfer || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Due at Signing:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${(data.dueAtSigning || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold pt-2 border-t border-gray-300 dark:border-gray-600">
                    <span className="text-gray-900 dark:text-white">Adjusted Cap Cost:</span>
                    <span className="text-gray-900 dark:text-white">
                      ${paymentData.adjustedCapCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">
                        ({data.discount ? `-${data.discount.toFixed(1)}%` : '0%'} discount)
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Residual Value:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${paymentData.residualValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({data.residualPercent}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Depreciation:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${paymentData.depreciation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Lease Term:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{data.leaseTerm} months</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">APR:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{data.apr || (data.marketFactor ? (data.marketFactor * 2400).toFixed(2) : '0')}%</span>
                  </div>
                  {data.marketFactor > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Money Factor:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{data.marketFactor.toFixed(4)}</span>
                    </div>
                  )}
                  {data.salesTaxPercent > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Sales Tax:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{data.salesTaxPercent}%</span>
                    </div>
                  )}
                  {data.ficoScore8 > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">FICO Score 8:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {data.ficoScore8} ({getFicoRecommendations().tier})
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {data.ficoScore8 > 0 && (
              <div className={`mt-6 p-4 rounded-lg border-2 ${
                getFicoRecommendations().color === 'green' ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' :
                getFicoRecommendations().color === 'blue' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' :
                getFicoRecommendations().color === 'yellow' ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700' :
                getFicoRecommendations().color === 'orange' ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700' :
                'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
              }`}>
                <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Credit Score Recommendations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected APR Range:</p>
                    <p className="text-sm text-gray-900 dark:text-white font-semibold">{getFicoRecommendations().expectedAprRange}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected Money Factor Range:</p>
                    <p className="text-sm text-gray-900 dark:text-white font-semibold">{getFicoRecommendations().expectedMoneyFactorRange}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Key Recommendations:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-800 dark:text-gray-200">
                    {getFicoRecommendations().recommendations.slice(0, 3).map((rec, index) => (
                      <li key={index}>{rec}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {(data.apr > 0 || data.marketFactor > 0) && (
              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Monthly Payment Calculation</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Monthly Depreciation:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${paymentData.rates.find(r => Math.abs(r.apr - paymentData.currentApr) < 0.01)?.monthlyDepreciation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Monthly Finance Charge:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${paymentData.rates.find(r => Math.abs(r.apr - paymentData.currentApr) < 0.01)?.monthlyFinanceCharge.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Base Monthly Payment:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${paymentData.rates.find(r => Math.abs(r.apr - paymentData.currentApr) < 0.01)?.baseMonthlyPayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                    </span>
                  </div>
                  {data.salesTaxPercent > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Sales Tax ({data.salesTaxPercent}%):</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        ${((paymentData.rates.find(r => Math.abs(r.apr - paymentData.currentApr) < 0.01)?.baseMonthlyPayment || 0) * (data.salesTaxPercent / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-300 dark:border-gray-600">
                    <span className="text-gray-900 dark:text-white">Total Monthly Payment:</span>
                    <span className="text-blue-600 dark:text-blue-400">
                      ${paymentData.rates.find(r => Math.abs(r.apr - paymentData.currentApr) < 0.01)?.totalMonthlyPayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-gray-300 dark:border-gray-600">
                    <div className="space-y-2">
                      {(() => {
                        const monthlyPayment = paymentData.rates.find(r => Math.abs(r.apr - paymentData.currentApr) < 0.01)?.totalMonthlyPayment || 0;
                        const leaseTerm = data.leaseTerm;
                        const periods: Array<{ label: string; months: number; total: number }> = [];
                        
                        // First 12 months
                        periods.push({
                          label: 'First 12 months',
                          months: Math.min(12, leaseTerm),
                          total: monthlyPayment * Math.min(12, leaseTerm)
                        });
                        
                        // Second 12 months (if lease > 12 months)
                        if (leaseTerm > 12) {
                          periods.push({
                            label: 'Second 12 months',
                            months: Math.min(12, leaseTerm - 12),
                            total: monthlyPayment * Math.min(12, leaseTerm - 12)
                          });
                        }
                        
                        // Third 12 months (if lease > 24 months)
                        if (leaseTerm > 24) {
                          periods.push({
                            label: 'Third 12 months',
                            months: Math.min(12, leaseTerm - 24),
                            total: monthlyPayment * Math.min(12, leaseTerm - 24)
                          });
                        }
                        
                        // Remaining months (if lease is not a multiple of 12)
                        const remainingMonths = leaseTerm % 12;
                        if (remainingMonths > 0 && leaseTerm > 12) {
                          periods.push({
                            label: `Remaining ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}`,
                            months: remainingMonths,
                            total: monthlyPayment * remainingMonths
                          });
                        }
                        
                        return periods.map((period, index) => (
                          <div key={index} className="flex justify-between items-center">
                            <span className="text-gray-600 dark:text-gray-400 text-sm">
                              {period.label}:
                            </span>
                            <span className="font-semibold text-gray-900 dark:text-white">
                              ${period.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

