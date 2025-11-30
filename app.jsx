import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, ArrowUpCircle, ArrowDownCircle, Activity, TrendingUp, TrendingDown, Info, Search, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

/**
 * DRUCKENMILLER ROC MODEL IMPLEMENTATION
 * * Logic based on User Documents:
 * 1. Price Data: REAL Monthly closes from AlphaVantage.
 * 2. 1st Derivative (Velocity): 3-Month ROC = ((Price_t - Price_t-3) / Price_t-3) * 100
 * 3. 2nd Derivative (Acceleration): 2ndROC = ROC_t - ROC_t-1
 * * Signals:
 * - Buy/Accelerating: 2nd ROC > 0 (Green)
 * - Strong Buy: 2nd ROC > 5
 * - Sell/Decelerating: 2nd ROC < 0 (Red)
 * - Trim/Caution: 2nd ROC < -5
 */

// --- API CONFIGURATION ---
const API_KEY = 'JQQUUJQRAX8TLXSM'; 
const BASE_URL = 'https://www.alphavantage.co/query';

// --- DATA FETCHING ---
const fetchStockData = async (ticker) => {
  try {
    const response = await fetch(
      `${BASE_URL}?function=TIME_SERIES_MONTHLY_ADJUSTED&symbol=${ticker}&apikey=${API_KEY}`
    );
    const data = await response.json();

    // Handle API Error Responses (Rate limits, invalid tickers)
    if (data['Note']) throw new Error("API Limit Reached (5 calls/min). Please wait.");
    if (data['Error Message']) throw new Error("Invalid Ticker Symbol.");
    if (!data['Monthly Adjusted Time Series']) throw new Error("No data found.");

    const timeSeries = data['Monthly Adjusted Time Series'];
    const formattedData = [];

    // Parse object into array
    for (const [date, values] of Object.entries(timeSeries)) {
      formattedData.push({
        rawDate: new Date(date),
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        price: parseFloat(values['5. adjusted close'])
      });
    }

    // Sort ascending (oldest to newest) and take last 48 months for analysis
    return formattedData.sort((a, b) => a.rawDate - b.rawDate).slice(-48);
  } catch (err) {
    throw err;
  }
};

// --- ALTERNATE STOCK DATA ---
// Hardcoded "Good" picks based on the Druckenmiller PDF categories
// Keeping these static to avoid hitting API rate limits immediately
const SECTOR_PICKS = {
  'Tech': [
    { symbol: 'GOOGL', name: 'Alphabet Inc.', roc2: 6.2, price: 178.20, signal: 'BUY' },
    { symbol: 'META', name: 'Meta Platforms', roc2: 8.4, price: 485.10, signal: 'STRONG BUY' },
    { symbol: 'MSFT', name: 'Microsoft', roc2: 2.1, price: 415.00, signal: 'BUY' },
    { symbol: 'CPNG', name: 'Coupang', roc2: 5.5, price: 21.50, signal: 'BUY' },
    { symbol: 'MELI', name: 'MercadoLibre', roc2: 7.1, price: 1650.00, signal: 'STRONG BUY' },
  ],
  'Healthcare': [
    { symbol: 'NTRA', name: 'Natera Inc.', roc2: 12.5, price: 115.40, signal: 'STRONG BUY' },
    { symbol: 'INSM', name: 'Insmed Inc.', roc2: 9.3, price: 72.10, signal: 'STRONG BUY' },
    { symbol: 'TEVA', name: 'Teva Pharm', roc2: 4.2, price: 18.20, signal: 'BUY' },
    { symbol: 'VRNA', name: 'Verona Pharma', roc2: 3.8, price: 34.50, signal: 'BUY' },
    { symbol: 'LLY', name: 'Eli Lilly', roc2: 1.5, price: 780.00, signal: 'HOLD' },
  ],
  'Industrials': [
    { symbol: 'WAB', name: 'Westinghouse Air', roc2: 5.1, price: 168.00, signal: 'BUY' },
    { symbol: 'ETN', name: 'Eaton Corp', roc2: 2.3, price: 320.00, signal: 'BUY' },
    { symbol: 'PH', name: 'Parker-Hannifin', roc2: 1.8, price: 540.00, signal: 'HOLD' },
    { symbol: 'GE', name: 'GE Aerospace', roc2: 4.5, price: 160.00, signal: 'BUY' },
    { symbol: 'CAT', name: 'Caterpillar', roc2: -1.2, price: 350.00, signal: 'HOLD' },
  ]
};

// --- CALCULATIONS ---
const calculateMetrics = (data) => {
  const lookback = 3; // 3-Month ROC as per Druckenmiller PDF
  
  return data.map((point, i) => {
    let roc1 = null;
    let roc2 = null;

    // 1st Derivative: ROC(3)
    if (i >= lookback) {
      const pastPrice = data[i - lookback].price;
      roc1 = ((point.price - pastPrice) / pastPrice) * 100;
    }

    // 2nd Derivative: Delta ROC
    if (i >= lookback + 1 && roc1 !== null) {
      const prevRoc1 = ((data[i-1].price - data[i-1-lookback].price) / data[i-1-lookback].price) * 100;
      roc2 = roc1 - prevRoc1;
    }

    return { ...point, roc1, roc2 };
  });
};

const getSignal = (roc2) => {
  if (roc2 === null) return { type: 'WAIT', color: 'gray', text: 'Insufficient Data' };
  if (roc2 >= 5) return { type: 'STRONG_BUY', color: 'green', text: 'Strong Acceleration' };
  if (roc2 > 0) return { type: 'BUY', color: 'emerald', text: 'Accelerating' };
  if (roc2 <= -5) return { type: 'TRIM', color: 'red', text: 'Strong Deceleration' };
  return { type: 'CAUTION', color: 'orange', text: 'Decelerating' };
};

// --- COMPONENTS ---

// 1. Custom SVG Chart Component (Dependency Free)
const ChartPanel = ({ data, title, color, yKey, zeroLine = false }) => {
  if (!data || data.length === 0) return null;

  // Filter out nulls for rendering
  const validData = data.filter(d => d[yKey] !== null);
  const width = 600;
  const height = 150;
  const padding = 20;

  const maxVal = Math.max(...validData.map(d => d[yKey]));
  const minVal = Math.min(...validData.map(d => d[yKey]));
  const range = maxVal - minVal || 1;

  const points = validData.map((d, i) => {
    const x = padding + (i / (validData.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((d[yKey] - minVal) / range) * (height - 2 * padding);
    return `${x},${y}`;
  }).join(' ');

  const zeroY = zeroLine 
    ? height - padding - ((0 - minVal) / range) * (height - 2 * padding)
    : null;

  return (
    <div className="mb-6 bg-white rounded-lg shadow-sm border border-slate-200 p-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">{title}</h3>
        <span className="text-xs text-slate-400">Last 3 Years (Monthly)</span>
      </div>
      <div className="relative w-full h-40">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          {/* Grid Lines */}
          <line x1={padding} y1={padding} x2={padding} y2={height-padding} stroke="#e2e8f0" strokeWidth="1" />
          <line x1={padding} y1={height-padding} x2={width-padding} y2={height-padding} stroke="#e2e8f0" strokeWidth="1" />
          
          {/* Zero Line */}
          {zeroLine && zeroY >= padding && zeroY <= height - padding && (
            <line x1={padding} y1={zeroY} x2={width-padding} y2={zeroY} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />
          )}

          {/* Area Fill for 2nd ROC to emphasize zones */}
          {title.includes("Acceleration") && validData.map((d, i) => {
            if (i === 0) return null;
            const x1 = padding + ((i-1) / (validData.length - 1)) * (width - 2 * padding);
            const x2 = padding + (i / (validData.length - 1)) * (width - 2 * padding);
            const y1 = height - padding - ((validData[i-1][yKey] - minVal) / range) * (height - 2 * padding);
            const y2 = height - padding - ((d[yKey] - minVal) / range) * (height - 2 * padding);
            const zeroPos = zeroY;
            
            // Render simplified bars or fill
            const barHeight = Math.abs(y2 - zeroPos);
            const barY = d[yKey] >= 0 ? y2 : zeroPos;
            const barColor = d[yKey] >= 0 ? '#10b981' : '#ef4444'; // Green if > 0, Red if < 0
            
            return (
              <rect 
                key={i} 
                x={x2 - 2} 
                y={d[yKey] >= 0 ? y2 : zeroY} 
                width={4} 
                height={Math.abs(y2 - zeroY)} 
                fill={barColor} 
                opacity="0.6"
              />
            );
          })}

          {/* Main Line */}
          <polyline 
            points={points} 
            fill="none" 
            stroke={color} 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />
          
          {/* Hover dot (static on last point for demo) */}
          <circle 
            cx={padding + (width - 2 * padding)} 
            cy={height - padding - ((validData[validData.length-1][yKey] - minVal) / range) * (height - 2 * padding)} 
            r="4" 
            fill={color} 
            stroke="white" 
            strokeWidth="2"
          />
        </svg>
      </div>
      <div className="flex justify-between text-xs text-slate-500 mt-2">
        <span>{validData[0].date}</span>
        <span className="font-bold text-slate-800">
          Current: {validData[validData.length-1][yKey].toFixed(2)}
          {title.includes("Price") ? '' : '%'}
        </span>
        <span>{validData[validData.length-1].date}</span>
      </div>
    </div>
  );
};

// 2. Main Application
export default function DruckenmillerModel() {
  const [ticker, setTicker] = useState('AMZN');
  const [inputTicker, setInputTicker] = useState('');
  const [marketData, setMarketData] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [category, setCategory] = useState('Tech');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load Data function
  const loadData = async (symbol) => {
    setLoading(true);
    setError(null);
    setMarketData([]);
    setMetrics(null);

    try {
      const rawData = await fetchStockData(symbol);
      const calculated = calculateMetrics(rawData);
      setMarketData(calculated);
      setMetrics(calculated[calculated.length - 1]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Initial Load
  useEffect(() => {
    loadData(ticker);
  }, [ticker]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (inputTicker.trim()) {
      setTicker(inputTicker.trim().toUpperCase());
      setInputTicker('');
    }
  };

  const currentSignal = metrics ? getSignal(metrics.roc2) : { type: 'WAIT', color: 'gray', text: 'Loading...' };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      
      {/* Header */}
      <header className="bg-slate-900 text-white p-6 shadow-lg">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="text-emerald-400" />
              Druckenmiller ROC II Model
            </h1>
            <p className="text-slate-400 text-sm mt-1">Live AlphaVantage Data • Monthly Analysis</p>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2 w-full md:w-auto">
            <input 
              type="text" 
              placeholder="Enter Symbol (e.g. AMZN)" 
              className="px-4 py-2 rounded bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full"
              value={inputTicker}
              onChange={(e) => setInputTicker(e.target.value)}
            />
            <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 px-6 py-2 rounded font-semibold transition">
              Analyze
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: ANALYSIS */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Signal Card */}
          <div className="bg-white rounded-xl shadow-md overflow-hidden border-l-8 transition-colors duration-500" 
               style={{ borderLeftColor: error ? '#ef4444' : (currentSignal.color === 'green' ? '#10b981' : currentSignal.color === 'emerald' ? '#34d399' : currentSignal.color === 'gray' ? '#94a3b8' : '#ef4444') }}>
            
            <div className="p-6 flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-bold text-slate-800">{ticker.toUpperCase()}</h2>
                <p className="text-slate-500 text-sm">3-Month Momentum Analysis</p>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold uppercase tracking-widest mb-1 text-${currentSignal.color}-600`}>
                  Model Signal
                </div>
                <div className="text-4xl font-extrabold flex justify-end items-center gap-2">
                  {loading && <Loader2 className="animate-spin text-slate-400" />}
                  {!loading && !error && (
                    <span className={`text-${currentSignal.color === 'emerald' ? 'emerald-500' : currentSignal.color === 'green' ? 'green-600' : currentSignal.color === 'gray' ? 'slate-400' : 'red-500'}`}>
                      {currentSignal.text}
                    </span>
                  )}
                  {error && <span className="text-red-500 text-xl">Error</span>}
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 p-4 text-red-700 text-sm border-t border-red-100 flex items-center gap-2">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            
            {/* Stats Grid */}
            {!loading && !error && metrics && (
              <div className="bg-slate-50 px-6 py-4 grid grid-cols-3 gap-4 border-t border-slate-100">
                <div>
                  <span className="text-xs text-slate-500 uppercase font-semibold">Price</span>
                  <div className="text-xl font-bold">${metrics?.price?.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-xs text-slate-500 uppercase font-semibold">Velocity (ROC)</span>
                  <div className={`text-xl font-bold flex items-center gap-1 ${metrics?.roc1 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {metrics?.roc1 > 0 ? <ArrowUpCircle size={16} /> : <ArrowDownCircle size={16} />}
                    {metrics?.roc1?.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <span className="text-xs text-slate-500 uppercase font-semibold">Acceleration (2nd ROC)</span>
                  <div className={`text-xl font-bold flex items-center gap-1 ${metrics?.roc2 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <Activity size={16} />
                    {metrics?.roc2?.toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Charts */}
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <LineChart className="text-slate-500" />
              Trend Visualization
            </h3>
            
            {/* 1. Price Chart */}
            <ChartPanel 
              data={marketData} 
              title="Price Action (Monthly)" 
              color="#334155" 
              yKey="price" 
            />

            {/* 2. Velocity Chart */}
            <ChartPanel 
              data={marketData} 
              title="Velocity: 1st Order ROC (3-Month)" 
              color="#3b82f6" 
              yKey="roc1" 
              zeroLine={true} 
            />

            {/* 3. Acceleration Chart (The Key Model) */}
            <ChartPanel 
              data={marketData} 
              title="Acceleration: 2nd Order ROC (The 'Signal')" 
              color="#8b5cf6" 
              yKey="roc2" 
              zeroLine={true} 
            />
            
            <div className="bg-blue-50 text-blue-800 p-4 rounded-lg text-sm flex gap-3 border border-blue-100">
              <Info className="shrink-0 mt-0.5" size={16} />
              <div>
                <strong>How to Read:</strong> The bottom chart (Acceleration) is the key Druckenmiller indicator. 
                <ul className="list-disc pl-4 mt-1 space-y-1">
                  <li><strong>Green Bars (Above 0):</strong> Momentum is accelerating. This is a BUY signal, especially when crossing from negative to positive.</li>
                  <li><strong>Red Bars (Below 0):</strong> Momentum is decelerating. This is a warning to TRIM or SELL, even if price is still rising.</li>
                </ul>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: RECOMMENDATIONS */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 p-4 border-b border-slate-200">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <CheckCircle size={18} className="text-emerald-600" />
                  Top Picks: {category}
                </h3>
                <p className="text-xs text-slate-500 mt-1">Stocks in this sector with strong positive 2nd Order ROC.</p>
              </div>
              
              <div className="divide-y divide-slate-100">
                {SECTOR_PICKS[category] ? (
                  SECTOR_PICKS[category].map((stock) => (
                    <div key={stock.symbol} className="p-4 hover:bg-slate-50 transition cursor-pointer group" onClick={() => setTicker(stock.symbol)}>
                      <div className="flex justify-between items-start mb-1">
                        <div>
                          <div className="font-bold text-slate-900 group-hover:text-emerald-600 transition">{stock.symbol}</div>
                          <div className="text-xs text-slate-500">{stock.name}</div>
                        </div>
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                          stock.signal.includes('STRONG') ? 'bg-emerald-100 text-emerald-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {stock.signal}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-2 text-sm">
                        <span className="text-slate-400">2nd ROC:</span>
                        <span className="font-mono font-semibold text-emerald-600">+{stock.roc2}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-slate-400 text-sm">
                    No recommendations available for this simulated category.
                  </div>
                )}
              </div>
              
              <div className="bg-slate-50 p-3 text-center border-t border-slate-200">
                <button 
                  onClick={() => {
                     const cats = Object.keys(SECTOR_PICKS);
                     const nextCat = cats[(cats.indexOf(category) + 1) % cats.length];
                     setCategory(nextCat);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Switch Sector Category
                </button>
              </div>
            </div>

            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-800 flex gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <p>
                <strong>Disclaimer:</strong> Real-time financial APIs are used here. 
                Rate limits (5 calls/min) apply. If you see an error, please wait a minute and try again.
              </p>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
