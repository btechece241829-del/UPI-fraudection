import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import warnings

warnings.filterwarnings('ignore')

def run_segmentation():
    print("\n--- PayFind K-Means Segmentation Engine ---\n")
    print("[*] Loading RFM dataset (payfind_rfm_dataset.csv)...")
    
    try:
        df = pd.read_csv('payfind_rfm_dataset.csv')
    except FileNotFoundError:
        print("[!] Error: payfind_rfm_dataset.csv not found. Please run rfm_fraud_model.py first.")
        return

    features = ['recency_days', 'frequency_90d', 'monetary_avg']
    X = df[features]

    # 1. Standardize the data so Frequency and Monetary scale evenly
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # 2. Apply K-Means Clustering (k=3)
    print("[*] Applying K-Means clustering algorithm with k=3...")
    kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
    df['Cluster'] = kmeans.fit_predict(X_scaled)

    # 3. Segregate into Allowed, Suspicious, Blocked based on mathematical centroids
    # We calculate a 'Risk Score' combination (Monetary Volume * Frequency)
    centers = scaler.inverse_transform(kmeans.cluster_centers_)
    cluster_risk = []
    
    for i, center in enumerate(centers):
        risk = center[1] * center[2] 
        cluster_risk.append((i, risk))

    # Sort clusters by risk score ascending (Lowest -> Allowed, Medium -> Suspicious, Highest -> Blocked)
    cluster_risk.sort(key=lambda x: x[1])
    
    cluster_labels = {
        cluster_risk[0][0]: 'Allowed',      
        cluster_risk[1][0]: 'Suspicious',   
        cluster_risk[2][0]: 'Blocked'       
    }

    df['Decision_Segment'] = df['Cluster'].map(cluster_labels)

    # Print out mapping results
    print("\n--- Cluster Centroids & Assignment ---")
    for i, center in enumerate(centers):
        label = cluster_labels[i]
        print(f"Cluster {i} -> {label}:")
        print(f"  Avg Recency  : {center[0]:.1f} days")
        print(f"  Avg Frequency: {center[1]:.1f} txns")
        print(f"  Avg Monetary : INR {center[2]:.1f}\n")

    print("--- Distribution ---")
    print(df['Decision_Segment'].value_counts())
    print()

    # 4. Detailed Seaborn 2D Visualization
    print("[*] Generating 2D Seaborn Visualization (segmentation_2d.png)...")
    sns.set_theme(style="darkgrid")
    # Exact colors matching the dashboard UI
    palette = {'Allowed': '#10b981', 'Suspicious': '#f59e0b', 'Blocked': '#ef4444'}

    plt.figure(figsize=(10, 6))
    sns.scatterplot(
        data=df, 
        x='monetary_avg', 
        y='frequency_90d', 
        hue='Decision_Segment', 
        palette=palette,
        alpha=0.6,
        edgecolor=None
    )
    plt.title('Fraud Risk Segmentation: Frequency vs Monetary Volume', fontsize=16)
    plt.xlabel('Average Monetary Value (Log Scale)')
    plt.ylabel('Transaction Frequency (Log Scale)')
    plt.xscale('log')
    plt.yscale('log')
    plt.tight_layout()
    plt.savefig('segmentation_2d.png', dpi=300)
    plt.close()

    # 5. Matplotlib 3D Output
    print("[*] Generating 3D Matplotlib Visualization (segmentation_3d.png)...")
    fig = plt.figure(figsize=(10, 8))
    # '3d' requires mpl_toolkits.mplot3d which is automatically available in newer matplotlibs
    ax = fig.add_subplot(111, projection='3d')

    # Map colors over the 3D surface
    color_map = {'Allowed': 'green', 'Suspicious': 'orange', 'Blocked': 'red'}
    colors = df['Decision_Segment'].map(color_map)
    
    ax.scatter(df['recency_days'], df['frequency_90d'], df['monetary_avg'], c=colors, alpha=0.5, s=20)

    ax.set_xlabel('Recency (Days)')
    ax.set_ylabel('Frequency (90 Days)')
    ax.set_zlabel('Average Monetary Amount')
    ax.set_title('3D Data Segregation (K-Means)')

    # Build reliable legend for 3D axis
    import matplotlib.patches as mpatches
    recs = [mpatches.Rectangle((0,0),1,1,fc="green"), 
            mpatches.Rectangle((0,0),1,1,fc="orange"), 
            mpatches.Rectangle((0,0),1,1,fc="red")]
    ax.legend(recs, ['Allowed', 'Suspicious', 'Blocked'], loc='upper left')

    plt.tight_layout()
    plt.savefig('segmentation_3d.png', dpi=300)
    plt.close()

    print("\n[*] Successfully generated high-resolution visualizations!")
    
    # Export final file mapped with tags
    export_file = 'segmented_output.csv'
    df.to_csv(export_file, index=False)
    print(f"[*] Full segregated dataset exported to: {export_file}\n")

if __name__ == "__main__":
    run_segmentation()
