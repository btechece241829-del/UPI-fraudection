import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix
import warnings

warnings.filterwarnings('ignore')

def generate_rfm_dataset(n_users=10000, seed=42):
    """
    Generates a synthetic RFM (Recency, Frequency, Monetary) dataset 
    and assigns fraud probability labels.
    """
    np.random.seed(seed)
    
    # Generating using a mixture to artificially inflate medium and high-risk groups for visual balance
    n_allowed = int(n_users * 0.65)
    n_sus = int(n_users * 0.25)
    n_block = n_users - n_allowed - n_sus

    recency_allowed = np.random.exponential(scale=20, size=n_allowed)
    freq_allowed = np.random.lognormal(mean=1.5, sigma=0.5, size=n_allowed)
    mon_allowed = np.random.lognormal(mean=6.5, sigma=0.5, size=n_allowed)

    recency_sus = np.random.exponential(scale=60, size=n_sus)
    freq_sus = np.random.lognormal(mean=3.5, sigma=0.8, size=n_sus)
    mon_sus = np.random.lognormal(mean=8.5, sigma=0.8, size=n_sus)

    recency_block = np.random.exponential(scale=120, size=n_block)
    freq_block = np.random.lognormal(mean=5.5, sigma=1, size=n_block)
    mon_block = np.random.lognormal(mean=10.5, sigma=1, size=n_block)

    recency = np.concatenate([recency_allowed, recency_sus, recency_block])
    frequency = np.concatenate([freq_allowed, freq_sus, freq_block])
    monetary = np.concatenate([mon_allowed, mon_sus, mon_block])
    
    # Shuffle to eliminate ordered patterns
    idx = np.arange(n_users)
    np.random.shuffle(idx)
    
    recency_days = np.clip(recency[idx], 0, 180).astype(int)
    frequency_90d = np.clip(frequency[idx], 1, 500).astype(int)
    monetary_avg = np.clip(monetary[idx], 50, 500000).astype(int)

    # Combine into a DataFrame
    data = pd.DataFrame({
        'user_id': [f'USER_{i:05d}' for i in range(1, n_users + 1)],
        'recency_days': recency_days,
        'frequency_90d': frequency_90d,
        'monetary_avg': monetary_avg
    })

    print(f"[*] Generated synthetic features for {n_users} users.")

    return data

def assign_fraud_labels(data):
    """
    Assigns an 'is_fraud' label based on abnormal RFM patterns.
    Real-world fraud often targets dormant accounts (high R) with sudden high spend (high M),
    or accounts doing rapid micro/macro bursts (high F).
    """
    n_users = len(data)
    prob_fraud = np.zeros(n_users)

    # Risk Rule 1: High Frequency Bursts (Bot Activity / Card Testing)
    # Extremely active in the last 90 days, especially if recently seen
    prob_fraud += np.where((data['frequency_90d'] > 150) & (data['recency_days'] < 5), 0.4, 0)

    # Risk Rule 2: Exceptionally high monetary value (Account Takeover)
    prob_fraud += np.where(data['monetary_avg'] > 45000, 0.35, 0)

    # Risk Rule 3: Dormant account suddenly waking up with high spend (Sleeper Fraud)
    prob_fraud += np.where((data['recency_days'] > 120) & (data['monetary_avg'] > 20000), 0.5, 0)
    
    # Risk Rule 4: Micro-structuring (High frequency, very low monetary)
    prob_fraud += np.where((data['frequency_90d'] > 100) & (data['monetary_avg'] < 500), 0.25, 0)

    # Add random noise to simulate unpredictable human behavior
    prob_fraud += np.random.uniform(0, 0.2, n_users)

    # We want roughly a 4% dataset fraud rate (highly imbalanced like the real world)
    threshold = np.percentile(prob_fraud, 96)
    data['is_fraud'] = (prob_fraud >= threshold).astype(int)
    
    print(f"[*] Fraud Rate Assigned: {data['is_fraud'].mean() * 100:.2f}%\n")
    return data

def train_and_evaluate_model(data):
    """
    Trains a Machine Learning model using the RFM variables to predict fraud.
    """
    features = ['recency_days', 'frequency_90d', 'monetary_avg']
    X = data[features]
    y = data['is_fraud']
    
    # Split the dataset into 80% training and 20% testing
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    print("[*] Training Random Forest Classifier on RFM dataset...\n")
    
    # Random Forest is excellent for RFM tabular data handling non-linear boundaries
    model = RandomForestClassifier(n_estimators=100, random_state=42, class_weight='balanced')
    model.fit(X_train, y_train)

    # Predictions
    y_pred = model.predict(X_test)
    
    print("-" * 50)
    print("                MODEL EVALUATION")
    print("-" * 50)
    print("Confusion Matrix:")
    cm = confusion_matrix(y_test, y_pred)
    # Print it nicely
    print(f"True Negatives: {cm[0][0]}   False Positives: {cm[0][1]}")
    print(f"False Negatives: {cm[1][0]}   True Positives: {cm[1][1]}\n")
    
    print("Classification Report:")
    print(classification_report(y_test, y_pred, target_names=['Legitimate (0)', 'Fraud (1)']))
    
    print("-" * 50)
    print("           RFM FEATURE IMPORTANCE")
    print("-" * 50)
    importances = model.feature_importances_
    
    for feature, imp in zip(features, importances):
        print(f"  {feature.ljust(15)} : {imp * 100:.2f}% contribution to decision")
    print("-" * 50)

if __name__ == "__main__":
    print("\n--- Starting PayFind RFM ML Pipeline ---\n")
    
    # 1. Generate the Raw Dataset
    df = generate_rfm_dataset(10000)
    
    # 2. Add Fraud Logic constraints
    df = assign_fraud_labels(df)
    
    # 3. Export to CSV (This generates the dataset for analysis)
    csv_file = 'payfind_rfm_dataset.csv'
    df.to_csv(csv_file, index=False)
    print(f"[*] Dataset exported directly to: {csv_file}")
    print(df.head())
    print("\n")
    
    # 4. Train Model and Analyze
    train_and_evaluate_model(df)
